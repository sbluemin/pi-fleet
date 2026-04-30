import { EventEmitter } from 'events';
import type { McpServer, PromptResponse } from '@agentclientprotocol/sdk';

import type {
  AgentMode,
  CliDetectionResult,
  McpServerConfig,
  ProtocolType,
  UnifiedClientOptions,
} from '../types/config.js';
import type {
  AcpAvailableCommand,
  AcpContentBlock,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
  AcpPermissionRequestParams,
  AcpPermissionResponse,
  AcpSessionNewResult,
  AcpSessionUpdateParams,
  AcpToolCall,
  AcpToolCallUpdate,
} from '../types/acp.js';
import type { CodexJsonValue, CodexUserInput } from '../types/codex-app-server.js';
import type { ConnectionState, StructuredLogEntry } from '../types/common.js';
import type {
  ConnectResult,
  ConnectionInfo,
  IUnifiedAgentClient,
  UnifiedClientEvents,
} from './IUnifiedAgentClient.js';
import { CodexAppServerConnection } from '../connection/CodexAppServerConnection.js';
import { AcpConnection } from '../connection/AcpConnection.js';
import { CliDetector } from '../detector/CliDetector.js';
import {
  codexDeveloperInstructionsToConfigArg,
  createSpawnConfig,
  getBackendConfig,
  getYoloModeId,
  mcpServerConfigsToAcp,
  mcpServerConfigsToCodexArgs,
} from '../config/CliConfigs.js';
import { cleanEnvironment } from '../utils/env.js';
import { getProviderModels } from '../models/ModelRegistry.js';
import type { ProviderModelInfo } from '../models/schemas.js';

interface CodexPendingOverrides {
  model?: string;
  mode?: string;
  turnConfig: Record<string, string>;
  threadConfig: Record<string, string>;
}

interface CodexModeMapping {
  approvalPolicy: string;
  sandbox: string;
}

interface CodexThreadDefaultsForReset {
  cwd: string;
  approvalPolicy?: string;
  sandbox?: string;
  developerInstructions?: string;
  config?: Record<string, CodexJsonValue>;
}

interface CodexThreadDefaultsForResume {
  cwd: string;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
  developerInstructions?: string;
  config?: Record<string, CodexJsonValue>;
}

interface CodexAcpSpawnPlan {
  acpMcpServers: McpServer[];
  configOverrides: string[];
}

type CodexInternalProtocol = 'acp-bridge' | 'app-server';

const ACTIVE_CODEX_PROTOCOL: CodexInternalProtocol = 'acp-bridge';
const PUBLIC_ACP_PROTOCOL: ProtocolType = 'acp';
const INTERNAL_CODEX_ACP_BRIDGE_ID = 'codex-acp-bridge';
const CODEX_TURN_LEVEL_CONFIG_KEYS = new Set(['reasoning_effort', 'model']);
const CODEX_THREAD_POLICY_CONFIG_KEYS = new Set(['approvalPolicy', 'sandbox']);
const CODEX_ACP_REASONING_EFFORT_NONE_FALLBACK = 'low';

/**
 * Codex 내부 클라이언트.
 * app-server 경로와 ACP bridge 경로를 한 클래스 안에서 명시적으로 분리 구현합니다.
 */
export class UnifiedCodexAgentClient extends EventEmitter implements IUnifiedAgentClient {
  private acpConnection: AcpConnection | null = null;
  private appServerConnection: CodexAppServerConnection | null = null;
  private sessionId: string | null = null;
  private sessionCwd: string | null = null;
  private currentSystemPrompt: string | null = null;
  private pendingOverrides: CodexPendingOverrides | null = null;
  private detector = new CliDetector();

  on<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  once<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  off<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  private emitTyped<K extends keyof UnifiedClientEvents>(
    event: K,
    ...args: UnifiedClientEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  async connect(options: UnifiedClientOptions): Promise<ConnectResult> {
    await this.disconnect();
    if (options.cli && options.cli !== 'codex') {
      throw new Error('UnifiedCodexAgentClient는 codex CLI만 지원합니다.');
    }

    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      return this.connectViaAcp(options);
    }
    return this.connectViaAppServer(options);
  }

  async disconnect(): Promise<void> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      await this.disconnectAcp();
      return;
    }
    await this.disconnectAppServer();
  }

  async endSession(): Promise<void> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      await this.endSessionAcp();
      return;
    }
    await this.endSessionAppServer();
  }

  getConnectionInfo(): ConnectionInfo {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      return {
        cli: this.acpConnection ? 'codex' : null,
        protocol: this.acpConnection ? PUBLIC_ACP_PROTOCOL : null,
        sessionId: this.sessionId,
        state: this.acpConnection ? this.acpConnection.connectionState : 'disconnected',
      };
    }

    if (!this.appServerConnection) {
      return {
        cli: null,
        protocol: null,
        sessionId: null,
        state: 'disconnected',
      };
    }

    return {
      cli: 'codex',
      protocol: 'codex-app-server',
      sessionId: this.sessionId,
      state: this.appServerConnection.connectionState,
    };
  }

  async detectClis(): Promise<CliDetectionResult[]> {
    return this.detector.detectAll(true);
  }

  async sendMessage(content: string | AcpContentBlock[]): Promise<PromptResponse> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      return this.sendMessageAcp(content);
    }
    return this.sendMessageAppServer(content);
  }

  async cancelPrompt(): Promise<void> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      await this.cancelPromptAcp();
      return;
    }
    await this.cancelPromptAppServer();
  }

  async setModel(model: string): Promise<void> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      await this.setModelAcp(model);
      return;
    }
    this.ensurePendingOverrides().model = model;
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      await this.setConfigOptionAcp(configId, value);
      return;
    }

    const pending = this.ensurePendingOverrides();
    if (CODEX_TURN_LEVEL_CONFIG_KEYS.has(configId)) {
      pending.turnConfig[configId] = value;
      return;
    }

    pending.threadConfig[configId] = value;
    this.emitTyped('log', `[codex] config '${configId}' will apply on next thread/start or thread/resume`);
  }

  async setMode(mode: string): Promise<void> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      await this.setModeAcp(mode);
      return;
    }

    const resolved = this.resolveMode(mode);
    const pending = this.ensurePendingOverrides();
    pending.threadConfig.approvalPolicy = resolved.approvalPolicy;
    pending.threadConfig.sandbox = resolved.sandbox;
    pending.mode = undefined;
  }

  async setYoloMode(enabled: boolean): Promise<void> {
    return this.setMode(enabled ? getYoloModeId('codex') : 'default');
  }

  getAvailableModes(): AgentMode[] {
    return getBackendConfig('codex').modes ?? [];
  }

  getAvailableModels(): ProviderModelInfo | null {
    return getProviderModels('codex');
  }

  getCurrentSystemPrompt(): string | null {
    return this.currentSystemPrompt;
  }

  async loadSession(sessionId: string, mcpServers?: McpServerConfig[]): Promise<void> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      await this.loadSessionAcp(sessionId, mcpServers);
      return;
    }
    await this.loadSessionAppServer(sessionId, mcpServers);
  }

  async resetSession(cwd?: string): Promise<ConnectResult> {
    if (ACTIVE_CODEX_PROTOCOL === 'acp-bridge') {
      return this.resetSessionAcp(cwd);
    }
    return this.resetSessionAppServer(cwd);
  }

  private async connectViaAcp(options: UnifiedClientOptions): Promise<ConnectResult> {
    const spawnPlan = this.buildCodexAcpSpawnPlan(options);
    const spawnConfig = createSpawnConfig('codex', {
      ...options,
      configOverrides: spawnPlan.configOverrides,
    });
    const cleanEnv = cleanEnvironment(process.env, options.env);
    const connection = new AcpConnection({
      command: spawnConfig.command,
      args: spawnConfig.args,
      cliType: INTERNAL_CODEX_ACP_BRIDGE_ID,
      cwd: options.cwd,
      env: { ...cleanEnv },
      requestTimeout: options.timeout,
      initTimeout: options.timeout,
      promptIdleTimeout: options.promptIdleTimeout,
      clientInfo: options.clientInfo,
      autoApprove: options.autoApprove,
    });
    this.acpConnection = connection;
    this.setupAcpEventForwarding();

    const recentLogs: string[] = [];
    const collectLog = (message: string): void => {
      recentLogs.push(message);
      if (recentLogs.length > 30) {
        recentLogs.shift();
      }
    };
    connection.on('log', collectLog);

    let session: AcpSessionNewResult;
    try {
      session = await connection.connect(
        options.cwd,
        options.sessionId,
        spawnPlan.acpMcpServers,
        options.systemPrompt,
      );
    } catch (error) {
      const connectionError = this.buildAcpConnectionError(error, recentLogs);
      await this.cleanupFailedAcpConnection();
      throw connectionError;
    } finally {
      connection.off('log', collectLog);
    }

    this.sessionId = session.sessionId;
    this.sessionCwd = options.cwd;
    this.currentSystemPrompt = options.systemPrompt ?? null;
    this.pendingOverrides = null;

    return {
      cli: 'codex',
      protocol: PUBLIC_ACP_PROTOCOL,
      session,
    };
  }

  private async connectViaAppServer(options: UnifiedClientOptions): Promise<ConnectResult> {
    const backend = getBackendConfig('codex');
    const cleanEnv = cleanEnvironment(process.env, options.env);
    const command = options.cliPath ?? backend.cliCommand;
    const baseArgs = backend.appServerArgs ?? ['app-server', '--listen', 'stdio://'];
    const developerInstructions = options.systemPrompt ?? null;
    const modeMapping = this.resolveMode(options.yoloMode === false ? 'default' : 'yolo');
    const args = [
      ...baseArgs,
      ...this.buildStartupConfigArgs(options.configOverrides, options.mcpServers, modeMapping),
    ];
    const mcpServerNames = this.resolveMcpServerNames(options.configOverrides, options.mcpServers);
    const connection = new CodexAppServerConnection({
      command,
      args,
      cwd: options.cwd,
      env: cleanEnv,
      requestTimeout: options.timeout ?? 600_000,
      initTimeout: options.timeout ?? 60_000,
      promptIdleTimeout: options.promptIdleTimeout ?? 600_000,
      clientInfo: options.clientInfo,
      autoApprove: options.autoApprove,
      mcpServerNames,
      mcpStartupTimeout: options.timeout ?? 60_000,
    });
    this.appServerConnection = connection;
    this.setupAppServerEventForwarding();

    if (options.sessionId) {
      await connection.connect({
        skipThreadStart: true,
        model: options.model,
      });
      await connection.loadSession(
        options.sessionId,
        this.buildCodexThreadDefaultsForResume(
          options.cwd,
          options.model,
          developerInstructions,
          modeMapping,
        ),
      );
    } else {
      await connection.connect({
        developerInstructions: developerInstructions ?? undefined,
        model: options.model,
        approvalPolicy: modeMapping.approvalPolicy,
        sandbox: modeMapping.sandbox,
      });
    }

    this.sessionId = connection.sessionId;
    this.sessionCwd = options.cwd;
    this.currentSystemPrompt = developerInstructions;
    this.pendingOverrides = {
      turnConfig: {},
      threadConfig: {
        approvalPolicy: modeMapping.approvalPolicy,
        sandbox: modeMapping.sandbox,
      },
    };

    return {
      cli: 'codex',
      protocol: 'codex-app-server',
    };
  }

  private async disconnectAcp(): Promise<void> {
    if (!this.acpConnection) {
      this.clearSessionState();
      return;
    }

    const conn = this.acpConnection;
    if (this.sessionId && conn.canResetSession) {
      try {
        await conn.endSession(this.sessionId);
      } catch {
        // 세션 종료 실패는 프로세스 정리를 막지 않습니다.
      }
    }

    await conn.disconnect();
    conn.removeAllListeners();
    this.acpConnection = null;
    this.clearSessionState();
  }

  private async disconnectAppServer(): Promise<void> {
    if (!this.appServerConnection) {
      this.clearSessionState();
      return;
    }

    const conn = this.appServerConnection;
    await conn.disconnect();
    conn.removeAllListeners();
    this.appServerConnection = null;
    this.clearSessionState();
  }

  private async endSessionAcp(): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.acpConnection.endSession(this.sessionId);
    this.sessionId = null;
  }

  private async endSessionAppServer(): Promise<void> {
    if (!this.appServerConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.appServerConnection.endSession();
    this.sessionId = null;
    this.sessionCwd = null;
  }

  private async sendMessageAcp(content: string | AcpContentBlock[]): Promise<PromptResponse> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    return this.acpConnection.sendPrompt(this.sessionId, content);
  }

  private async sendMessageAppServer(content: string | AcpContentBlock[]): Promise<PromptResponse> {
    if (!this.appServerConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    this.applyPendingOverrides();
    const input: CodexUserInput[] = typeof content === 'string'
      ? [{ type: 'text', text: content, text_elements: [] }]
      : content.map((block) => ('text' in block
        ? { type: 'text' as const, text: block.text, text_elements: [] }
        : { type: 'text' as const, text: JSON.stringify(block), text_elements: [] }));
    await this.appServerConnection.sendMessage(input);
    return { stopReason: 'end_turn' } as PromptResponse;
  }

  private async cancelPromptAcp(): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.acpConnection.cancelSession(this.sessionId);
  }

  private async cancelPromptAppServer(): Promise<void> {
    if (!this.appServerConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.appServerConnection.cancelPrompt();
  }

  private async setModelAcp(model: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.acpConnection.setModel(this.sessionId, model);
  }

  private async setConfigOptionAcp(configId: string, value: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    const acpValue = configId === 'reasoning_effort' && value === 'none'
      ? CODEX_ACP_REASONING_EFFORT_NONE_FALLBACK
      : value;
    await this.acpConnection.setConfigOption(this.sessionId, configId, acpValue);
  }

  private async setModeAcp(mode: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.acpConnection.setMode(this.sessionId, mode);
  }

  private async loadSessionAcp(sessionId: string, mcpServers?: McpServerConfig[]): Promise<void> {
    if (!this.acpConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.acpConnection.loadSession({
      sessionId,
      cwd: this.sessionCwd ?? process.cwd(),
      mcpServers: this.resolveAcpMcpServers(mcpServers),
    });
    this.sessionId = sessionId;
    this.currentSystemPrompt = null;
  }

  private async loadSessionAppServer(sessionId: string, mcpServers?: McpServerConfig[]): Promise<void> {
    if (!this.appServerConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    if (mcpServers?.length) {
      this.emitTyped(
        'log',
        '[codex] mcpServers on loadSession are ignored; pass them to connect() so app-server starts with -c overrides',
      );
    }
    const targetCwd = this.sessionCwd ?? process.cwd();
    await this.appServerConnection.loadSession(
      sessionId,
      this.buildCodexThreadDefaultsForResume(
        targetCwd,
        undefined,
        this.currentSystemPrompt,
        this.pendingOverrides?.threadConfig ?? {},
      ),
    );
    this.sessionId = sessionId;
  }

  private async resetSessionAcp(cwd?: string): Promise<ConnectResult> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    const targetCwd = cwd ?? this.sessionCwd ?? process.cwd();
    if (!this.acpConnection.canResetSession) {
      throw new Error('[codex] 세션 리셋을 지원하지 않습니다. disconnect() 후 재연결하세요.');
    }

    await this.acpConnection.endSession(this.sessionId);
    this.sessionId = null;

    const session = await this.acpConnection.createSession(
      targetCwd,
      undefined,
      [],
      this.currentSystemPrompt ?? undefined,
    );

    this.sessionId = session.sessionId;
    this.sessionCwd = targetCwd;

    return {
      cli: 'codex',
      protocol: PUBLIC_ACP_PROTOCOL,
      session,
    };
  }

  private async resetSessionAppServer(cwd?: string): Promise<ConnectResult> {
    if (!this.appServerConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    const targetCwd = cwd ?? this.sessionCwd ?? process.cwd();
    const result = await this.appServerConnection.resetSession(
      this.buildCodexThreadDefaultsForReset(targetCwd),
    );
    this.sessionId = result.thread.id;
    this.sessionCwd = targetCwd;
    this.pendingOverrides = {
      turnConfig: {},
      threadConfig: this.pendingOverrides?.threadConfig ?? {},
    };
    return {
      cli: 'codex',
      protocol: 'codex-app-server',
    };
  }

  private clearSessionState(): void {
    this.sessionId = null;
    this.sessionCwd = null;
    this.currentSystemPrompt = null;
    this.pendingOverrides = null;
  }

  private setupAcpEventForwarding(): void {
    if (!this.acpConnection) return;

    this.acpConnection.on('stateChange', (state: ConnectionState) => {
      this.emitTyped('stateChange', state);
    });
    this.acpConnection.on('userMessageChunk', (text: string, sessionId: string) => {
      this.emitTyped('userMessageChunk', text, sessionId);
    });
    this.acpConnection.on('messageChunk', (text: string, sessionId: string) => {
      this.emitTyped('messageChunk', text, sessionId);
    });
    this.acpConnection.on('thoughtChunk', (text: string, sessionId: string) => {
      this.emitTyped('thoughtChunk', text, sessionId);
    });
    this.acpConnection.on(
      'toolCall',
      (title: string, status: string, sessionId: string, data?: AcpToolCall) => {
        this.emitTyped('toolCall', title, status, sessionId, data);
      },
    );
    this.acpConnection.on(
      'toolCallUpdate',
      (title: string, status: string, sessionId: string, data?: AcpToolCallUpdate) => {
        this.emitTyped('toolCallUpdate', title, status, sessionId, data);
      },
    );
    this.acpConnection.on('plan', (plan: string, sessionId: string) => {
      this.emitTyped('plan', plan, sessionId);
    });
    this.acpConnection.on(
      'availableCommandsUpdate',
      (commands: AcpAvailableCommand[], sessionId: string) => {
        this.emitTyped('availableCommandsUpdate', commands, sessionId);
      },
    );
    this.acpConnection.on('sessionUpdate', (update: unknown) => {
      this.emitTyped('sessionUpdate', update as AcpSessionUpdateParams);
    });
    this.acpConnection.on('permissionRequest', (params, resolve) => {
      this.emitTyped(
        'permissionRequest',
        params as AcpPermissionRequestParams,
        resolve as (response: AcpPermissionResponse) => void,
      );
    });
    this.acpConnection.on('fileRead', (params, resolve) => {
      this.emitTyped(
        'fileRead',
        params as AcpFileReadParams,
        resolve as (response: AcpFileReadResponse) => void,
      );
    });
    this.acpConnection.on('fileWrite', (params, resolve) => {
      this.emitTyped(
        'fileWrite',
        params as AcpFileWriteParams,
        resolve as (response: AcpFileWriteResponse) => void,
      );
    });
    this.acpConnection.on('promptComplete', (sessionId: string) => {
      this.emitTyped('promptComplete', sessionId);
    });
    this.acpConnection.on('error', (err: Error) => {
      this.emitTyped('error', err);
    });
    this.acpConnection.on('exit', (code: number | null, signal: string | null) => {
      this.emitTyped('exit', code, signal);
    });
    this.acpConnection.on('log', (msg: string) => {
      this.emitTyped('log', msg);
    });
    this.acpConnection.on('logEntry', (entry: StructuredLogEntry) => {
      this.emitTyped('logEntry', entry);
    });
  }

  private setupAppServerEventForwarding(): void {
    if (!this.appServerConnection) return;

    this.appServerConnection.on('stateChange', (state: ConnectionState) => {
      this.emitTyped('stateChange', state);
    });
    this.appServerConnection.on('userMessageChunk', (text: string, sessionId: string) => {
      this.emitTyped('userMessageChunk', text, sessionId);
    });
    this.appServerConnection.on('messageChunk', (text: string, sessionId: string) => {
      this.emitTyped('messageChunk', text, sessionId);
    });
    this.appServerConnection.on('thoughtChunk', (text: string, sessionId: string) => {
      this.emitTyped('thoughtChunk', text, sessionId);
    });
    this.appServerConnection.on('toolCall', (title: string, status: string, sessionId: string, data?: unknown) => {
      this.emitTyped('toolCall', title, status, sessionId, data as AcpToolCall | undefined);
    });
    this.appServerConnection.on('toolCallUpdate', (title: string, status: string, sessionId: string, data?: unknown) => {
      this.emitTyped('toolCallUpdate', title, status, sessionId, data as AcpToolCallUpdate | undefined);
    });
    this.appServerConnection.on('plan', (plan: string, sessionId: string) => {
      this.emitTyped('plan', plan, sessionId);
    });
    this.appServerConnection.on('promptComplete', (sessionId: string) => {
      this.emitTyped('promptComplete', sessionId);
    });
    this.appServerConnection.on('permissionRequest', (params, resolve) => {
      this.emitTyped(
        'permissionRequest',
        params as AcpPermissionRequestParams,
        resolve as (response: AcpPermissionResponse) => void,
      );
    });
    this.appServerConnection.on('sessionUpdate', (update: unknown) => {
      this.emitTyped('sessionUpdate', update as AcpSessionUpdateParams);
    });
    this.appServerConnection.on('error', (err: Error) => {
      this.emitTyped('error', err);
    });
    this.appServerConnection.on('exit', (code: number | null, signal: string | null) => {
      this.emitTyped('exit', code, signal);
    });
    this.appServerConnection.on('log', (msg: string) => {
      this.emitTyped('log', msg);
    });
    this.appServerConnection.on('logEntry', (entry: StructuredLogEntry) => {
      this.emitTyped('logEntry', entry);
    });
  }

  private ensurePendingOverrides(): CodexPendingOverrides {
    if (!this.pendingOverrides) {
      this.pendingOverrides = {
        turnConfig: {},
        threadConfig: {},
      };
    }
    return this.pendingOverrides;
  }

  private applyPendingOverrides(): void {
    if (!this.pendingOverrides || !this.appServerConnection) {
      return;
    }

    if (this.pendingOverrides.model) {
      this.appServerConnection.setPendingModel(this.pendingOverrides.model);
      this.pendingOverrides.model = undefined;
    }

    if (this.pendingOverrides.turnConfig.model) {
      this.appServerConnection.setPendingModel(this.pendingOverrides.turnConfig.model);
      delete this.pendingOverrides.turnConfig.model;
    }

    if (this.pendingOverrides.turnConfig.reasoning_effort) {
      this.appServerConnection.setPendingEffort(this.pendingOverrides.turnConfig.reasoning_effort);
      delete this.pendingOverrides.turnConfig.reasoning_effort;
    }
  }

  private buildCodexThreadDefaultsForReset(cwd: string): CodexThreadDefaultsForReset {
    const threadConfig = this.pendingOverrides?.threadConfig ?? {};
    const { approvalPolicy, sandbox } = threadConfig;
    const configEntries = Object.entries(threadConfig)
      .filter(([key]) => !CODEX_THREAD_POLICY_CONFIG_KEYS.has(key));
    const config = configEntries.length > 0
      ? Object.fromEntries(configEntries) as Record<string, CodexJsonValue>
      : undefined;

    return {
      cwd,
      approvalPolicy,
      sandbox,
      developerInstructions: this.currentSystemPrompt ?? undefined,
      config,
    };
  }

  private buildCodexThreadDefaultsForResume(
    cwd: string,
    model: string | undefined,
    systemPrompt: string | null,
    threadConfig: Partial<CodexModeMapping> | Record<string, string>,
  ): CodexThreadDefaultsForResume {
    const { approvalPolicy, sandbox } = threadConfig;
    const configEntries = Object.entries(threadConfig)
      .filter(([key]) => !CODEX_THREAD_POLICY_CONFIG_KEYS.has(key));
    const config = configEntries.length > 0
      ? Object.fromEntries(configEntries) as Record<string, CodexJsonValue>
      : undefined;

    return {
      cwd,
      ...(model ? { model } : {}),
      approvalPolicy,
      sandbox,
      developerInstructions: systemPrompt ?? undefined,
      config,
    };
  }

  private resolveMode(modeId: string): CodexModeMapping {
    switch (modeId) {
      case 'autoEdit':
        return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
      case 'yolo':
        return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
      default:
        return { approvalPolicy: 'on-request', sandbox: 'read-only' };
    }
  }

  private buildStartupConfigArgs(
    overrides?: string[],
    servers?: McpServerConfig[],
    modeMapping?: CodexModeMapping,
  ): string[] {
    const configArgs = [
      ...(modeMapping ? [
        `approval_policy="${modeMapping.approvalPolicy}"`,
        `sandbox_mode="${modeMapping.sandbox}"`,
      ] : []),
      ...(overrides ?? []),
      ...(servers?.length ? mcpServerConfigsToCodexArgs(servers) : []),
    ];

    return configArgs.flatMap((override) => ['-c', override]);
  }

  private resolveMcpServerNames(
    overrides?: string[],
    servers?: McpServerConfig[],
  ): string[] {
    const names = new Set<string>();
    for (const server of servers ?? []) {
      names.add(server.name);
    }
    for (const override of overrides ?? []) {
      const match = /^mcp_servers\.([^.]+)\./.exec(override);
      if (match) {
        names.add(match[1]);
      }
    }
    return [...names];
  }

  private buildCodexAcpSpawnPlan(options: UnifiedClientOptions): CodexAcpSpawnPlan {
    const modeMapping = this.resolveMode(options.yoloMode === false ? 'default' : 'yolo');
    return {
      acpMcpServers: this.resolveAcpMcpServers(options.mcpServers),
      configOverrides: [
        `approval_policy="${modeMapping.approvalPolicy}"`,
        `sandbox_mode="${modeMapping.sandbox}"`,
        ...(options.configOverrides ?? []),
        ...(options.systemPrompt ? [codexDeveloperInstructionsToConfigArg(options.systemPrompt)] : []),
        ...(options.mcpServers?.length ? mcpServerConfigsToCodexArgs(options.mcpServers) : []),
      ],
    };
  }

  private resolveAcpMcpServers(mcpServers?: McpServerConfig[]): McpServer[] {
    return mcpServers?.length ? mcpServerConfigsToAcp(mcpServers) : [];
  }

  private async cleanupFailedAcpConnection(): Promise<void> {
    if (!this.acpConnection) {
      this.clearSessionState();
      return;
    }

    try {
      await this.acpConnection.disconnect();
    } catch {
      // 실패 연결 정리는 best-effort입니다.
    }
    this.acpConnection.removeAllListeners();
    this.acpConnection = null;
    this.clearSessionState();
  }

  private buildAcpConnectionError(error: unknown, recentLogs: string[]): Error {
    const base = error instanceof Error ? error.message : String(error);
    const extra = recentLogs.length > 0
      ? `\n최근 로그:\n${recentLogs.map((line) => `- ${line}`).join('\n')}`
      : '';
    return new Error(`[codex] ACP 연결 실패: ${base}${extra}`);
  }
}
