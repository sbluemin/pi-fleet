/**
 * UnifiedAgentClient - 통합 에이전트 클라이언트
 * 모든 CLI를 하나의 인터페이스로 통합하는 최상위 클래스
 */

import { EventEmitter } from 'events';
import type { PromptResponse, McpServer } from '@agentclientprotocol/sdk';
import type {
  CliType,
  UnifiedClientOptions,
  CliDetectionResult,
  AgentMode,
  McpServerConfig,
} from '../types/config.js';
import type {
  AcpAvailableCommand,
  AcpContentBlock,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
  AcpSessionNewResult,
  AcpToolCall,
  AcpToolCallUpdate,
} from '../types/acp.js';
import type { ConnectionState, StructuredLogEntry } from '../types/common.js';
import type {
  IUnifiedAgentClient,
  ConnectResult,
  ConnectionInfo,
  UnifiedClientEvents,
} from './IUnifiedAgentClient.js';
import { AcpConnection } from '../connection/AcpConnection.js';
import { CliDetector } from '../detector/CliDetector.js';
import {
  createSpawnConfig,
  getBackendConfig,
  getYoloModeId,
  mcpServerConfigsToCodexArgs,
  mcpServerConfigsToAcp,
} from '../config/CliConfigs.js';
import { cleanEnvironment, isWindows } from '../utils/env.js';
import { getProviderModels } from '../models/ModelRegistry.js';
import type { ProviderModelInfo } from '../models/schemas.js';
import { getProcessPool } from '../pool/ProcessPool.js';

// 인터페이스 파일에서 타입 re-export
export type { UnifiedClientEvents, ConnectResult, ConnectionInfo, IUnifiedAgentClient } from './IUnifiedAgentClient.js';

/**
 * 통합 에이전트 클라이언트.
 * CLI 자동 감지, ACP 프로토콜 추상화, 이벤트 기반 스트리밍을 제공합니다.
 */
export class UnifiedAgentClient extends EventEmitter implements IUnifiedAgentClient {
  private acpConnection: AcpConnection | null = null;
  private activeCli: CliType | null = null;
  private sessionId: string | null = null;
  private sessionCwd: string | null = null;
  /** 현재 세션 정책으로 유지할 systemPrompt 원문입니다. */
  private currentSystemPrompt: string | null = null;
  /** firstPromptPending은 Codex·Gemini 전용입니다.
   * Claude는 _meta.systemPrompt.append로 AcpConnection 계층에서 처리됩니다. */
  private firstPromptPending: string | null = null;
  private bypassedPool = false;
  private detector = new CliDetector();

  /** 타입 안전한 이벤트 리스너 등록 */
  on<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  /** 타입 안전한 1회성 이벤트 리스너 등록 */
  once<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  /** 타입 안전한 이벤트 리스너 해제 */
  off<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  /** 타입 안전한 이벤트 발생 */
  private emitTyped<K extends keyof UnifiedClientEvents>(
    event: K,
    ...args: UnifiedClientEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * CLI에 연결합니다.
   *
   * @param options - 연결 옵션
   * @returns 연결 결과
   */
  async connect(options: UnifiedClientOptions): Promise<ConnectResult> {
    // 기존 연결 정리
    await this.disconnect();

    // 세션 재개 시 CLI 미지정 방지 (자동 감지로 엉뚱한 CLI에 재개 시도하는 문제 차단)
    if (options.sessionId && !options.cli) {
      throw new Error('세션 재개 시 cli 지정이 필요합니다.');
    }

    // CLI 선택: 명시적 지정 → 자동 감지 순서
    if (options.cli) {
      return this.connectAcp(options.cli, options);
    }

    const preferred = await this.detector.getPreferred();
    if (!preferred) {
      throw new Error(
        '사용 가능한 CLI가 없습니다. gemini, claude, codex 중 하나를 설치해주세요.',
      );
    }

    return this.connectAcp(preferred.cli, options);
  }

  /**
   * ACP 프로토콜로 연결합니다.
   * Pool에 idle 엔트리가 있으면 재사용하고, 없으면 새로 spawn합니다.
   */
  private async connectAcp(
    cli: CliType,
    options: UnifiedClientOptions,
  ): Promise<ConnectResult> {
    const shouldBypassPool = this.shouldBypassPool(cli, options);

    // MCP 서버 설정을 CLI별로 분기 변환
    const { acpMcpServers, effectiveOptions } = this.resolveMcpServers(cli, options);

    // Pool에서 acquire 시도
    if (!shouldBypassPool) {
      const pool = getProcessPool();
      const pooled = pool.acquire(cli);

      if (pooled) {
      // Pool에서 획득한 connection 재사용: createSession만 호출
        this.acpConnection = pooled;
        this.bypassedPool = false;
        this.setupAcpEventForwarding();

        let session: AcpSessionNewResult;
        try {
          session = await pooled.createSession(
            effectiveOptions.cwd,
            effectiveOptions.sessionId,
            acpMcpServers,
            effectiveOptions.systemPrompt,
          );
        } catch (error) {
          const connectionError = this.buildConnectionError(cli, error, []);
          await this.cleanupFailedAcpConnection();
          throw connectionError;
        }

        return this.finalizeConnect(cli, effectiveOptions, session);
      }
    }

    // Pool에 없으면 새로 spawn
    const spawnConfig = createSpawnConfig(cli, effectiveOptions);
    const cleanEnv = cleanEnvironment(process.env, effectiveOptions.env);

    const env: Record<string, string | undefined> = { ...cleanEnv };

    if (cli === 'gemini' && isWindows() && env.GEMINI_CLI_NO_RELAUNCH === undefined) {
      env.GEMINI_CLI_NO_RELAUNCH = 'true';
    }

    this.acpConnection = new AcpConnection({
      command: spawnConfig.command,
      args: spawnConfig.args,
      cliType: cli,
      cwd: effectiveOptions.cwd,
      env,
      requestTimeout: effectiveOptions.timeout,
      initTimeout: effectiveOptions.timeout,
      promptIdleTimeout: effectiveOptions.promptIdleTimeout,
      clientInfo: effectiveOptions.clientInfo,
      autoApprove: effectiveOptions.autoApprove,
    });
    this.bypassedPool = shouldBypassPool;

    this.setupAcpEventForwarding();

    const recentLogs: string[] = [];
    const collectLog = (message: string): void => {
      recentLogs.push(message);
      if (recentLogs.length > 30) {
        recentLogs.shift();
      }
    };
    this.acpConnection.on('log', collectLog);

    let session: AcpSessionNewResult;
    try {
      session = await this.acpConnection.connect(
        effectiveOptions.cwd,
        effectiveOptions.sessionId,
        acpMcpServers,
        effectiveOptions.systemPrompt,
      );
    } catch (error) {
      const connectionError = this.buildConnectionError(cli, error, recentLogs);
      await this.cleanupFailedAcpConnection();
      throw connectionError;
    } finally {
      this.acpConnection?.off('log', collectLog);
    }

    return this.finalizeConnect(cli, effectiveOptions, session);
  }

  /**
   * McpServerConfig[]를 CLI별로 분기 처리합니다.
   * - codex: MCP 설정을 `-c` 옵션으로 변환, ACP mcpServers는 빈 배열
   * - claude/gemini: MCP 설정을 ACP McpServer로 변환
   */
  private resolveMcpServers(
    cli: CliType,
    options: UnifiedClientOptions,
  ): { acpMcpServers: McpServer[]; effectiveOptions: UnifiedClientOptions } {
    const servers = options.mcpServers;

    if (!servers || servers.length === 0) {
      return { acpMcpServers: [], effectiveOptions: options };
    }

    if (cli === 'codex') {
      // Codex: MCP 설정을 -c 옵션으로 변환하여 configOverrides에 병합
      const mcpArgs = mcpServerConfigsToCodexArgs(servers);
      const mergedOverrides = [...(options.configOverrides ?? []), ...mcpArgs];
      return {
        acpMcpServers: [],
        effectiveOptions: { ...options, configOverrides: mergedOverrides, mcpServers: undefined },
      };
    }

    // Claude/Gemini: ACP McpServer로 변환
    return {
      acpMcpServers: mcpServerConfigsToAcp(servers),
      effectiveOptions: options,
    };
  }

  /**
   * Codex는 요청 단위 `-c`/MCP override가 있으면 spawn 인자가 세션마다 달라집니다.
   * 이 경우 pooled 재사용 시 현재 요청의 spawn 계약을 반영할 수 없어 pool을 우회합니다.
   */
  private shouldBypassPool(cli: CliType, options: UnifiedClientOptions): boolean {
    if (cli !== 'codex') {
      return false;
    }

    return (options.mcpServers?.length ?? 0) > 0 || (options.configOverrides?.length ?? 0) > 0;
  }

  /** Claude는 연결 계층에서 _meta로 처리하고, Codex/Gemini만 첫 user turn 선행 block을 arm합니다. */
  private armFirstPromptPending(
    cli: CliType | null,
    systemPrompt: string | null,
    isResume: boolean,
  ): void {
    if (!cli || isResume || !systemPrompt) {
      this.firstPromptPending = null;
      return;
    }

    if (cli === 'claude') {
      this.firstPromptPending = null;
      return;
    }

    this.firstPromptPending = systemPrompt;
  }

  /**
   * 연결 완료 후 공통 후처리 (YOLO 모드, 모델 설정, 상태 저장).
   */
  private async finalizeConnect(
    cli: CliType,
    options: UnifiedClientOptions,
    session: AcpSessionNewResult,
  ): Promise<ConnectResult> {
    // YOLO 모드 설정
    if (options.yoloMode && session.sessionId) {
      try {
        await this.acpConnection!.setMode(session.sessionId, getYoloModeId(cli));
      } catch {
        // YOLO 모드 미지원 CLI인 경우 무시
      }
    }

    // 모델 설정
    if (options.model && session.sessionId) {
      try {
        await this.acpConnection!.setModel(session.sessionId, options.model);
      } catch {
        // 모델 설정 미지원 CLI인 경우 무시
      }
    }

    this.activeCli = cli;
    this.sessionId = session.sessionId;
    this.sessionCwd = options.cwd;
    this.currentSystemPrompt = options.systemPrompt ?? null;
    this.armFirstPromptPending(cli, this.currentSystemPrompt, Boolean(options.sessionId));

    return {
      cli,
      protocol: 'acp',
      session,
    };
  }

  /**
   * 현재 프로세스를 유지한 채 세션만 교체합니다.
   *
   * @param cwd - 새 세션의 작업 디렉토리 (선택, 미지정 시 현재 cwd 재사용)
   * @returns 연결 결과
   */
  async resetSession(cwd?: string): Promise<ConnectResult> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }

    const targetCwd = cwd ?? this.sessionCwd ?? process.cwd();

    // close capability 없는 CLI(Gemini 등)는 newSession 재호출이 hang됩니다
    if (!this.acpConnection.canResetSession) {
      throw new Error(
        `[${this.activeCli}] 세션 리셋을 지원하지 않습니다. disconnect() 후 재연결하세요.`,
      );
    }

    await this.acpConnection.endSession(this.sessionId);
    this.sessionId = null;

    const session = await this.acpConnection.reconnectSession(
      targetCwd,
      undefined,
      undefined,
      this.currentSystemPrompt ?? undefined,
    );

    this.sessionId = session.sessionId;
    this.sessionCwd = targetCwd;
    this.armFirstPromptPending(this.activeCli, this.currentSystemPrompt, false);

    return {
      cli: this.activeCli!,
      protocol: 'acp',
      session,
    };
  }

  /**
   * 현재 세션을 종료합니다.
   * 프로세스는 유지되며 Pool에 반환하지 않습니다.
   * disconnect()와 달리 연결 자체는 유지됩니다.
   */
  async endSession(): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    await this.acpConnection.endSession(this.sessionId);
    this.sessionId = null;
  }

  /**
   * 메시지를 전송합니다.
   *
   * @param content - 메시지 내용 (텍스트 또는 ACP ContentBlock 배열)
   * @returns 프롬프트 처리 결과
   */
  async sendMessage(content: string | AcpContentBlock[]): Promise<PromptResponse> {
    if (this.acpConnection && this.sessionId) {
      const systemPrompt = this.firstPromptPending;
      if (!systemPrompt) {
        return this.acpConnection.sendPrompt(this.sessionId, content);
      }

      const userBlocks: AcpContentBlock[] = typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : content;

      const response = await this.acpConnection.sendPrompt(this.sessionId, [
        { type: 'text', text: systemPrompt },
        ...userBlocks,
      ]);

      this.firstPromptPending = null;
      return response;
    }

    throw new Error('연결되어 있지 않습니다');
  }

  /**
   * 현재 진행 중인 프롬프트를 취소합니다.
   */
  async cancelPrompt(): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.cancelSession(this.sessionId);
  }

  /**
   * 모델을 변경합니다.
   *
   * @param model - 모델 이름
   */
  async setModel(model: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setModel(this.sessionId, model);
  }

  /**
   * 세션 설정 옵션을 변경합니다.
   *
   * @param configId - 설정 옵션 ID
   * @param value - 설정 값
   */
  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setConfigOption(this.sessionId, configId, value);
  }

  /**
   * 에이전트 모드를 설정합니다.
   * CLI별 지원 모드: Gemini(default/autoEdit/yolo), Claude(default/plan/bypassPermissions), Codex(default/autoEdit/yolo) 등.
   *
   * @param mode - 모드 ID (e.g., 'plan', 'yolo', 'bypassPermissions')
   */
  async setMode(mode: string): Promise<void> {
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setMode(this.sessionId, mode);
  }

  /**
   * YOLO 모드를 설정합니다.
   * setMode()의 편의 래퍼입니다.
   *
   * @param enabled - 활성화 여부
   */
  async setYoloMode(enabled: boolean): Promise<void> {
    if (!enabled) {
      return this.setMode('default');
    }
    if (!this.activeCli) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.setMode(getYoloModeId(this.activeCli));
  }

  /**
   * 현재 CLI에서 사용 가능한 에이전트 모드 목록을 반환합니다.
   *
   * @returns 모드 목록 (모드 미지원 시 빈 배열)
   */
  getAvailableModes(): AgentMode[] {
    if (!this.activeCli) return [];
    const config = getBackendConfig(this.activeCli);
    return config.modes ?? [];
  }

  /**
   * 사용 가능한 모델 목록을 정적 레지스트리에서 반환합니다.
   *
   * @param cli - CLI 타입 (생략 시 현재 연결된 CLI)
   * @returns 프로바이더 모델 정보 (연결 전이고 cli 미지정 시 null)
   */
  getAvailableModels(cli?: CliType): ProviderModelInfo | null {
    const target = cli ?? this.activeCli;
    if (!target) return null;
    return getProviderModels(target);
  }

  /** 현재 세션에 스냅샷된 systemPrompt를 반환합니다. */
  getCurrentSystemPrompt(): string | null {
    return this.currentSystemPrompt;
  }

  /**
   * 기존 세션을 로드합니다.
   *
   * @param sessionId - 로드할 세션 ID
   * @param mcpServers - 에이전트에 연결할 MCP 서버 목록 (선택, 기본: [])
   */
  async loadSession(sessionId: string, mcpServers?: McpServerConfig[]): Promise<void> {
    if (!this.acpConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    const acpServers = mcpServers ? mcpServerConfigsToAcp(mcpServers) : [];

    await this.acpConnection.loadSession({
      sessionId,
      cwd: this.sessionCwd ?? process.cwd(),
      mcpServers: acpServers,
    });

    this.sessionId = sessionId;
    this.currentSystemPrompt = null;
    this.firstPromptPending = null;
  }

  /**
   * 사용 가능한 CLI 목록을 감지합니다.
   */
  async detectClis(): Promise<CliDetectionResult[]> {
    return this.detector.detectAll(true);
  }

  /**
   * 연결 정보를 반환합니다.
   */
  getConnectionInfo(): ConnectionInfo {
    const state: ConnectionState = this.acpConnection
      ? this.acpConnection.connectionState
      : 'disconnected';

    return {
      cli: this.activeCli,
      protocol: this.activeCli ? 'acp' : null,
      sessionId: this.sessionId,
      state,
    };
  }

  /**
   * 연결을 닫습니다.
   * Claude/Codex(canResetSession=true): endSession → pool.release로 프로세스 재사용.
   * Gemini(canResetSession=false): pool.release에서 disconnect (프로세스 kill).
   */
  async disconnect(): Promise<void> {
    if (this.acpConnection) {
      const conn = this.acpConnection;
      const cli = this.activeCli;

      if (this.bypassedPool) {
        await conn.disconnect();
        conn.removeAllListeners();
      } else if (cli && this.sessionId && conn.canResetSession) {
        // Claude/Codex: endSession 후 Pool에 반환
        try {
          await conn.endSession(this.sessionId);
          conn.removeAllListeners();
          const pool = getProcessPool();
          await pool.release(cli, conn);
        } catch {
          // endSession 실패 시 fallback: 프로세스 kill
          await conn.disconnect();
          conn.removeAllListeners();
        }
      } else if (cli) {
        // Gemini 또는 세션 없음: Pool에 release (내부에서 disconnect 호출됨)
        conn.removeAllListeners();
        const pool = getProcessPool();
        await pool.release(cli, conn);
      } else {
        // CLI 없음: 직접 disconnect
        await conn.disconnect();
        conn.removeAllListeners();
      }

      this.acpConnection = null;
    }

    this.activeCli = null;
    this.sessionId = null;
    this.sessionCwd = null;
    this.currentSystemPrompt = null;
    this.firstPromptPending = null;
    this.bypassedPool = false;
  }

  /**
   * ACP 이벤트를 통합 클라이언트로 전파합니다.
   */
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
    this.acpConnection.on('toolCall', (title: string, status: string, sessionId: string, data?: AcpToolCall) => {
      this.emitTyped('toolCall', title, status, sessionId, data);
    });
    this.acpConnection.on('toolCallUpdate', (title: string, status: string, sessionId: string, data?: AcpToolCallUpdate) => {
      this.emitTyped('toolCallUpdate', title, status, sessionId, data);
    });
    this.acpConnection.on('plan', (plan: string, sessionId: string) => {
      this.emitTyped('plan', plan, sessionId);
    });
    this.acpConnection.on('availableCommandsUpdate', (commands: AcpAvailableCommand[], sessionId: string) => {
      this.emitTyped('availableCommandsUpdate', commands, sessionId);
    });
    this.acpConnection.on('sessionUpdate', (update: AcpSessionUpdateParams) => {
      this.emitTyped('sessionUpdate', update);
    });
    this.acpConnection.on('permissionRequest', (params: AcpPermissionRequestParams, resolve: (response: AcpPermissionResponse) => void) => {
      this.emitTyped('permissionRequest', params, resolve);
    });
    this.acpConnection.on('fileRead', (params: AcpFileReadParams, resolve: (response: AcpFileReadResponse) => void) => {
      this.emitTyped('fileRead', params, resolve);
    });
    this.acpConnection.on('fileWrite', (params: AcpFileWriteParams, resolve: (response: AcpFileWriteResponse) => void) => {
      this.emitTyped('fileWrite', params, resolve);
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

  private async cleanupFailedAcpConnection(): Promise<void> {
    if (!this.acpConnection) {
      return;
    }

    try {
      await this.acpConnection.disconnect();
    } catch {
    }

    this.acpConnection.removeAllListeners();
    this.acpConnection = null;
    this.activeCli = null;
    this.sessionId = null;
    this.sessionCwd = null;
    this.bypassedPool = false;
  }

  /**
   * 연결 실패 시 인증 필요 여부를 판별해 사용자가 이해하기 쉬운 에러로 변환합니다.
   */
  private buildConnectionError(cli: CliType, error: unknown, recentLogs: string[]): Error {
    const backend = getBackendConfig(cli);
    if (backend.authRequired && this.isAuthenticationError(error, recentLogs)) {
      return new Error(
        `[${cli}] 인증이 필요하거나 인증이 만료되었습니다. 먼저 해당 CLI에서 로그인/인증을 완료한 뒤 다시 시도해주세요.`,
      );
    }

    if (error instanceof Error) {
      return error;
    }

    // ACP SDK의 JSON-RPC ErrorResponse는 plain object { code, message, data? }로 reject됨
    if (typeof error === 'object' && error !== null) {
      const obj = error as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        const code = typeof obj.code === 'number' ? ` (code: ${obj.code})` : '';
        const data = obj.data ? ` — ${JSON.stringify(obj.data)}` : '';
        return new Error(`${obj.message}${code}${data}`);
      }
      // message 필드가 없는 plain object도 JSON으로 직렬화
      return new Error(JSON.stringify(error));
    }

    return new Error(String(error));
  }

  /**
   * 예외/로그 패턴 기반으로 인증 관련 실패를 판별합니다.
   */
  private isAuthenticationError(error: unknown, recentLogs: string[]): boolean {
    const authPatterns = [
      /auth_required/i,
      /authentication required/i,
      /not authenticated/i,
      /please login/i,
      /please log in/i,
      /sign in/i,
      /reauth/i,
      /unauthorized/i,
      /invalid api key/i,
    ];

    if (this.matchAnyPattern(this.extractErrorText(error), authPatterns)) {
      return true;
    }

    return recentLogs.some((log) => this.matchAnyPattern(log, authPatterns));
  }

  /**
   * 에러 객체에서 메시지 분석용 텍스트를 추출합니다.
   */
  private extractErrorText(error: unknown): string {
    if (error instanceof Error) {
      const code = (error as { code?: unknown }).code;
      if (code === -32000) {
        return `auth_required ${error.message}`;
      }
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return String(error);
  }

  /**
   * 문자열이 패턴 목록 중 하나와 일치하는지 검사합니다.
   */
  private matchAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
  }
}
