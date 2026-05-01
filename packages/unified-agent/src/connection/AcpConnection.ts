/**
 * AcpConnection - 공식 ACP SDK 기반 연결 구현
 * ClientSideConnection을 래핑하여 Gemini, Claude, Codex 통합 통신
 */

import {
  ClientSideConnection,
  type Client,
  type Agent,
  type SessionNotification,
  type SessionUpdate,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type NewSessionResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type InitializeResponse,
  type PromptResponse,
  type ContentBlock,
  type McpServer,
  type Stream,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
} from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConnectionState, StructuredLogEntry } from '../types/common.js';
import type {
  AcpAvailableCommand,
  AcpAvailableCommandsUpdate,
  AcpToolCall,
  AcpToolCallUpdate,
} from '../types/acp.js';
import type { CliType } from '../types/config.js';
import { BaseConnection, type BaseConnectionOptions } from './BaseConnection.js';

/** AcpConnection 생성 옵션 */
export interface AcpConnectionOptions extends BaseConnectionOptions {
  /** CLI 종류 */
  cliType?: CliType;
  /** 클라이언트 정보 */
  clientInfo?: {
    name: string;
    version: string;
  };
  /** ACP 프로토콜 버전 (uint16 숫자, 기본: 1) */
  protocolVersion?: number;
  /** 자동 권한 승인 여부 */
  autoApprove?: boolean;
}

/** AcpConnection 이벤트 맵 */
export interface AcpConnectionEventMap {
  userMessageChunk: [text: string, sessionId: string];
  messageChunk: [text: string, sessionId: string];
  thoughtChunk: [text: string, sessionId: string];
  toolCall: [title: string, status: string, sessionId: string, data?: AcpToolCall];
  toolCallUpdate: [title: string, status: string, sessionId: string, data?: AcpToolCallUpdate];
  plan: [plan: string, sessionId: string];
  availableCommandsUpdate: [commands: AcpAvailableCommand[], sessionId: string, data?: AcpAvailableCommandsUpdate];
  sessionUpdate: [update: SessionNotification];
  permissionRequest: [params: RequestPermissionRequest, resolve: (response: RequestPermissionResponse) => void];
  fileRead: [params: ReadTextFileRequest, resolve: (response: ReadTextFileResponse) => void];
  fileWrite: [params: WriteTextFileRequest, resolve: (response: WriteTextFileResponse) => void];
  promptComplete: [sessionId: string];
}

/** BaseConnection에서 상속되는 공통 이벤트 맵 */
interface BaseConnectionEventMap {
  stateChange: [state: ConnectionState];
  error: [error: Error];
  exit: [code: number | null, signal: string | null];
  log: [message: string];
  logEntry: [entry: StructuredLogEntry];
}

type AcpConnectionEvents = BaseConnectionEventMap & AcpConnectionEventMap;

/**
 * ACP 프로토콜 연결 클래스.
 * 공식 ACP SDK의 ClientSideConnection을 래핑하여 통합 이벤트 인터페이스를 제공합니다.
 */
export class AcpConnection extends BaseConnection {
  private readonly cliType: CliType | null;
  private readonly clientInfo: { name: string; version: string };
  private readonly protocolVersion: number;
  private readonly autoApprove: boolean;
  private activeSessionId: string | null = null;
  private agentProxy: Agent | null = null;
  private agentCapabilities: InitializeResponse['agentCapabilities'] | null = null;
  private readonly pendingPermissionRequests = new Set<(
    response: RequestPermissionResponse,
  ) => void>();

  /** 현재 프롬프트의 idle timeout 리셋 콜백 (null이면 프롬프트 미실행 중) */
  private promptKeepAlive: (() => void) | null = null;

  /** 자식 프로세스 참조 */
  get childProcess(): ChildProcess | null {
    return this.child;
  }

  constructor(options: AcpConnectionOptions) {
    super(options);
    this.cliType = options.cliType ?? null;
    this.clientInfo = options.clientInfo ?? {
      name: 'UnifiedAgent',
      version: '1.0.0',
    };
    this.protocolVersion = options.protocolVersion ?? 1;
    this.autoApprove = options.autoApprove ?? false;
  }

  /** 타입 안전한 이벤트 리스너 등록 */
  on<K extends keyof AcpConnectionEvents>(
    event: K,
    listener: (...args: AcpConnectionEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  /** 타입 안전한 1회성 이벤트 리스너 등록 */
  once<K extends keyof AcpConnectionEvents>(
    event: K,
    listener: (...args: AcpConnectionEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  /** 타입 안전한 이벤트 리스너 해제 */
  off<K extends keyof AcpConnectionEvents>(
    event: K,
    listener: (...args: AcpConnectionEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  /** 타입 안전한 이벤트 발생 */
  emit<K extends keyof AcpConnectionEvents>(
    event: K,
    ...args: AcpConnectionEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * spawn + initialize만 수행합니다 (세션 미생성).
   *
   * @param workspace - 작업 디렉토리 경로 (initialize에 필요)
   */
  async initializeConnection(_workspace: string): Promise<void> {
    const { stream } = this.spawnProcess();
    this.setState('initializing');

    try {
      await this.performInitialize(stream);
      this.setState('connected');
    } catch (error) {
      this.setState('error');
      try {
        await this.disconnect();
      } catch {
        // 정리 실패는 원본 예외를 가리지 않음
      }
      throw error;
    }
  }

  /**
   * 이미 initialized된 연결에서 세션을 생성하거나 로드합니다.
   *
   * @param workspace - 작업 디렉토리 경로
   * @param sessionId - 로드할 기존 세션 ID (선택)
   * @param mcpServers - 에이전트에 연결할 MCP 서버 목록 (선택, 기본: [])
   * @returns 세션 정보
   */
  async createSession(
    workspace: string,
    sessionId?: string,
    mcpServers?: McpServer[],
    systemPrompt?: string,
  ): Promise<NewSessionResponse> {
    const agent = this.getAgent();
    const servers = mcpServers ?? [];

    let session: NewSessionResponse;
    if (sessionId) {
      if (!agent.loadSession) {
        throw new Error('연결된 에이전트가 session/load를 지원하지 않습니다');
      }
      const loadResult = await this.withFixedTimeout(
        agent.loadSession({ sessionId, cwd: workspace, mcpServers: servers }),
        this.initTimeout,
        'session/load',
      );
      session = { ...loadResult, sessionId } as LoadSessionResponse & NewSessionResponse;
    } else {
      const newSessionParams: {
        cwd: string;
        mcpServers: McpServer[];
        _meta?: Record<string, unknown>;
      } = {
        cwd: workspace,
        mcpServers: servers,
      };

      const claudeSystemPrompt = this.getClaudeSystemPrompt(systemPrompt);
      if (claudeSystemPrompt) {
        newSessionParams._meta = {
          systemPrompt: {
            append: claudeSystemPrompt,
          },
        };
      }

      session = await this.withFixedTimeout(
        agent.newSession(newSessionParams),
        this.initTimeout,
        'session/new',
      );
    }

    this.setState('ready');
    this.activeSessionId = session.sessionId;
    return session;
  }

  /**
   * ACP 연결을 시작합니다.
   * 프로세스 spawn → ClientSideConnection 생성 → initialize → 세션 생성까지 수행합니다.
   *
   * @param workspace - 작업 디렉토리 경로
   * @returns 세션 정보
   */
  async connect(
    workspace: string,
    sessionId?: string,
    mcpServers?: McpServer[],
    systemPrompt?: string,
  ): Promise<NewSessionResponse> {
    await this.initializeConnection(workspace);
    try {
      return await this.createSession(workspace, sessionId, mcpServers, systemPrompt);
    } catch (error) {
      this.setState('error');
      try {
        await this.disconnect();
      } catch {
        // 정리 실패는 원본 예외를 가리지 않음
      }
      throw error;
    }
  }

  /**
   * 기존 세션을 로드합니다.
   *
   * @param params - 세션 로드 파라미터
   * @returns 세션 정보
   */
  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const agent = this.getAgent();
    if (!agent.loadSession) {
      throw new Error('연결된 에이전트가 session/load를 지원하지 않습니다');
    }

    const result = await this.withFixedTimeout(
      agent.loadSession(params),
      this.requestTimeout,
      'session/load',
    );
    this.activeSessionId = params.sessionId;
    this.setState('ready');
    return result;
  }

  /**
   * 현재 세션을 종료합니다 (프로세스는 유지).
   * close capability가 있는 에이전트만 unstable_closeSession을 호출합니다.
   * Gemini 등 close 미지원 에이전트는 아무것도 하지 않습니다 (hang 방지).
   *
   * @param sessionId - 종료할 세션 ID
   */
  async endSession(sessionId: string): Promise<void> {
    if (this.agentCapabilities?.sessionCapabilities?.close != null) {
      const agent = this.getAgent();
      try {
        await agent.unstable_closeSession?.({ sessionId });
      } catch {
        // best-effort: 실패 무시
      }
    }
    // 프로세스 유지 — disconnect 호출 금지
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  /**
   * 기존 연결에서 새 세션을 생성하거나 기존 세션을 로드합니다.
   * initialize()는 재호출하지 않습니다 (E1: ClientSideConnection 세션 전환 시 재생성 금지).
   *
   * @param workspace - 작업 디렉토리 경로
   * @param sessionId - 로드할 기존 세션 ID (선택, 없으면 새 세션 생성)
   * @returns 세션 정보
   */
  /**
   * 세션 리셋(newSession 재호출) 가능 여부를 반환합니다.
   * close capability가 없는 Gemini는 두 번째 newSession 호출 시 hang되므로 false를 반환합니다.
   */
  get canResetSession(): boolean {
    return this.agentCapabilities?.sessionCapabilities?.close != null;
  }

  async reconnectSession(
    workspace: string,
    sessionId?: string,
    mcpServers?: McpServer[],
    systemPrompt?: string,
  ): Promise<NewSessionResponse> {
    // close capability가 없는 CLI(Gemini 등)는 newSession 재호출 시 hang됩니다
    if (!sessionId && !this.canResetSession) {
      throw new Error(
        `[${this.command}] 세션 리셋을 지원하지 않습니다 (session/close 미지원). disconnect() 후 재연결하세요.`,
      );
    }

    if (sessionId && this.agentCapabilities?.loadSession !== true) {
      throw new Error(`[${this.command}] loadSession을 지원하지 않습니다 (E3)`);
    }

    return this.createSession(workspace, sessionId, mcpServers, systemPrompt);
  }

  /** Claude bridge만 native system prompt append를 지원하므로 이 경로만 사용합니다. */
  private getClaudeSystemPrompt(systemPrompt?: string): string | null {
    if (
      this.cliType !== 'claude' &&
      this.cliType !== 'claude-zai' &&
      this.cliType !== 'claude-kimi'
    ) {
      return null;
    }

    if (!systemPrompt) {
      return null;
    }

    return systemPrompt;
  }

  override async disconnect(): Promise<void> {
    this.cancelPendingPermissionRequests();
    this.flushStderrBuffer();
    this.activeSessionId = null;
    await super.disconnect();
  }

  /** CLI/세션 메타를 포함한 구조화 stderr 로그 항목을 보강합니다. */
  protected createStructuredLogEntry(message: string): StructuredLogEntry {
    return {
      ...super.createStructuredLogEntry(message),
      ...(this.cliType ? { cli: this.cliType } : {}),
      ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
    };
  }

  /**
   * 메시지를 전송합니다.
   *
   * idle timeout: 스트리밍 활동이 없으면 promptIdleTimeout 후 타임아웃.
   * fixed timeout: requestTimeout을 absolute safety net으로 유지.
   *
   * @param sessionId - 세션 ID
   * @param content - 메시지 내용 (텍스트 또는 ACP ContentBlock 배열)
   */
  async sendPrompt(
    sessionId: string,
    content: string | ContentBlock[],
  ): Promise<PromptResponse> {
    const agent = this.getAgent();

    const prompt = typeof content === 'string'
      ? ([{ type: 'text', text: content }] as Array<Extract<ContentBlock, { type: 'text' }>>)
      : content;

    const rawPromise = agent.prompt({ sessionId, prompt });

    // idle timeout 래핑 (활동 기반 타임아웃)
    const [idleWrapped, keepAlive] = this.createIdleTimeoutRace(
      rawPromise,
      this.promptIdleTimeout,
      'session/prompt',
    );
    this.promptKeepAlive = keepAlive;

    // requestTimeout을 absolute safety net으로 유지
    const finalPromise = this.requestTimeout > 0
      ? this.withFixedTimeout(idleWrapped, this.requestTimeout, 'session/prompt')
      : idleWrapped;

    try {
      const response = await finalPromise;
      this.emit('promptComplete', sessionId);
      return response;
    } catch (error) {
      // idle timeout 시 서버 측 프롬프트를 취소 (stuck 방지를 위해 fire-and-forget)
      if (error instanceof Error && error.message.includes('유휴 상태')) {
        this.cancelSession(sessionId).catch(() => {});
      }
      throw error;
    } finally {
      this.promptKeepAlive = null;
    }
  }

  /**
   * 현재 세션의 진행 중인 프롬프트를 취소합니다.
   *
   * @param sessionId - 세션 ID
   */
  async cancelSession(sessionId: string): Promise<void> {
    const agent = this.getAgent();
    this.cancelPendingPermissionRequests();
    await this.withFixedTimeout(
      agent.cancel({ sessionId }),
      this.requestTimeout,
      'session/cancel',
    );
  }

  /**
   * 에이전트 모드를 설정합니다.
   * session/set_mode RPC를 사용합니다.
   *
   * @param sessionId - 세션 ID
   * @param mode - 모드 ID (e.g., 'default', 'yolo', 'bypassPermissions')
   */
  async setMode(
    sessionId: string,
    mode: string = 'default',
  ): Promise<void> {
    const agent = this.getAgent();
    await this.withFixedTimeout(
      agent.setSessionMode?.({ sessionId, modeId: mode }),
      this.requestTimeout,
      'session/set_mode',
    );
  }

  /**
   * 모델을 변경합니다.
   * session/set_model (primary) → session/set_config_option (fallback)
   *
   * @param sessionId - 세션 ID
   * @param model - 모델 이름
   */
  async setModel(sessionId: string, model: string): Promise<void> {
    const agent = this.getAgent();

    try {
      // Primary: session/set_model
      await this.withFixedTimeout(
        agent.unstable_setSessionModel?.({ sessionId, modelId: model }),
        this.requestTimeout,
        'session/set_model',
      );
    } catch {
      // Fallback: session/set_config_option
      await this.setConfigOption(sessionId, 'model', model);
    }
  }

  /**
   * 설정 옵션을 변경합니다.
   * ACP session/set_config_option 메서드를 호출합니다.
   *
   * @param sessionId - 세션 ID
   * @param configId - 설정 옵션 ID (e.g., 'model', 'reasoning_effort')
   * @param value - 설정 값 ID
   */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<void> {
    const agent = this.getAgent();
    await this.withFixedTimeout(
      agent.setSessionConfigOption?.({ sessionId, configId, value }),
      this.requestTimeout,
      'session/set_config_option',
    );
  }

  /**
   * ClientSideConnection 생성 → initialize 공통 로직.
   * initializeConnection에서 호출됩니다.
   */
  private async performInitialize(stream: Stream): Promise<void> {
    const connection = new ClientSideConnection(
      (agent: Agent): Client => {
        this.agentProxy = agent;
        return this.createClientHandler();
      },
      stream,
    );

    // 연결 종료 감지
    connection.closed.then(() => {
      this.setState('closed');
    });

    const clientCapabilities = {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
      permissions: true,
      terminal: false,
    } as unknown as Parameters<Agent['initialize']>[0]['clientCapabilities'];

    const agent = this.getAgent();

    const initResult = await this.withFixedTimeout(
      agent.initialize({
        protocolVersion: this.protocolVersion,
        clientCapabilities,
        clientInfo: this.clientInfo,
      }),
      this.initTimeout,
      'initialize',
    );
    this.agentCapabilities = initResult.agentCapabilities ?? null;
  }

  /**
   * Client 인터페이스 구현체를 생성합니다.
   * Agent → Client 방향의 요청/알림을 이벤트로 전파합니다.
   */
  private createClientHandler(): Client {
    return {
      // 권한 요청 처리
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        this.promptKeepAlive?.();
        if (this.autoApprove && params.options && params.options.length > 0) {
          // 자동 승인: 첫 번째 옵션 선택
          return {
            outcome: {
              outcome: 'selected',
              optionId: params.options[0].optionId,
            },
          };
        }

        // 이벤트로 전파하고 응답 대기
        return new Promise<RequestPermissionResponse>((resolve) => {
          const trackedResolve = (response: RequestPermissionResponse): void => {
            this.pendingPermissionRequests.delete(trackedResolve);
            resolve(response);
          };

          this.pendingPermissionRequests.add(trackedResolve);
          this.emit('permissionRequest', params, trackedResolve);
        });
      },

      // 세션 업데이트 알림 처리
      sessionUpdate: async (notification: SessionNotification): Promise<void> => {
        this.emit('sessionUpdate', notification);
        this.processSessionUpdate(notification);
      },

      // 파일 읽기 요청 처리 - 직접 파일 I/O 수행
      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        this.promptKeepAlive?.();
        // 파일 존재 여부를 먼저 확인하여 ENOENT를 graceful하게 처리
        try {
          await access(params.path);
        } catch {
          return { content: '' };
        }

        const raw = await readFile(params.path, 'utf-8');
        let content = raw;

        // line/limit 옵션 처리 (1-based line number)
        if (params.line != null || params.limit != null) {
          const lines = raw.split('\n');
          const start = (params.line ?? 1) - 1;
          const end = params.limit != null ? start + params.limit : undefined;
          content = lines.slice(start, end).join('\n');
        }

        return { content };
      },

      // 파일 쓰기 요청 처리 - 직접 파일 I/O 수행
      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        this.promptKeepAlive?.();
        await mkdir(dirname(params.path), { recursive: true });
        await writeFile(params.path, params.content, 'utf-8');
        return {};
      },

      // 터미널 API는 아직 미지원
      createTerminal: async (_params: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
        throw new Error('terminal/create는 현재 지원되지 않습니다');
      },
      terminalOutput: async (_params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
        throw new Error('terminal/output은 현재 지원되지 않습니다');
      },
      releaseTerminal: async (_params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
        throw new Error('terminal/release는 현재 지원되지 않습니다');
      },
      waitForTerminalExit: async (_params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> => {
        throw new Error('terminal/wait_for_exit는 현재 지원되지 않습니다');
      },
      killTerminal: async (_params: KillTerminalRequest): Promise<KillTerminalResponse> => {
        throw new Error('terminal/kill은 현재 지원되지 않습니다');
      },
    };
  }

  /**
   * 세션 업데이트 알림을 파싱하여 개별 이벤트를 발생시킵니다.
   */
  private processSessionUpdate(notification: SessionNotification): void {
    if (!notification?.update) return;

    const { update } = notification;
    const sessionId = notification.sessionId;
    this.promptKeepAlive?.();

    switch (update.sessionUpdate) {
      case 'user_message_chunk': {
        this.emitTextChunk('userMessageChunk', update, sessionId);
        break;
      }

      case 'agent_message_chunk': {
        this.emitTextChunk('messageChunk', update, sessionId);
        break;
      }

      case 'agent_thought_chunk': {
        this.emitTextChunk('thoughtChunk', update, sessionId);
        break;
      }

      case 'tool_call': {
        // sessionUpdate 필드를 제외한 나머지를 ToolCall 데이터로 전달
        const { sessionUpdate: _tc, ...toolCallData } = update;
        this.emit(
          'toolCall',
          update.title ?? '',
          update.status ?? '',
          sessionId,
          toolCallData as AcpToolCall,
        );
        break;
      }

      case 'tool_call_update': {
        // sessionUpdate 필드를 제외한 나머지를 ToolCallUpdate 데이터로 전달
        const { sessionUpdate: _tcu, ...toolCallUpdateData } = update;
        this.emit(
          'toolCallUpdate',
          toolCallUpdateData.title ?? '',
          toolCallUpdateData.status ?? '',
          sessionId,
          toolCallUpdateData as AcpToolCallUpdate,
        );
        break;
      }

      case 'plan': {
        if (update.entries) {
          this.emit('plan', JSON.stringify(update.entries), sessionId);
        }
        break;
      }

      case 'available_commands_update': {
        this.emit(
          'availableCommandsUpdate',
          update.availableCommands,
          sessionId,
          update,
        );
        break;
      }

      default:
        break;
    }
  }

  /**
   * ContentChunk에서 텍스트 청크를 추출하여 해당 이벤트로 전파합니다.
   * ACP bridge가 CLI 내부 UI(스피너 등)를 agent_message_chunk로 전달하는 경우를 필터링합니다.
   */
  private emitTextChunk(
    event: 'userMessageChunk' | 'messageChunk' | 'thoughtChunk',
    update: Extract<SessionUpdate, { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk' }>,
    sessionId: string,
  ): void {
    if (this.isTextContent(update.content)) {
      const text = update.content.text;
      if (this.isSpinnerNoise(text)) return;
      this.emit(event, text, sessionId);
    }
  }

  /**
   * ContentBlock이 텍스트 블록인지 판별합니다.
   */
  private isTextContent(content: ContentBlock): content is Extract<ContentBlock, { type: 'text' }> {
    return content.type === 'text' && typeof content.text === 'string';
  }

  /**
   * ACP bridge가 CLI 내부 UI 텍스트를 agent_message_chunk로 전달하는 경우를 감지합니다.
   * Braille 스피너 프레임(U+2800-U+28FF)으로 시작하는 줄은 CLI 상태 표시 노이즈입니다.
   * 예: "⠧ Working...", "⠹  Claude"
   */
  private isSpinnerNoise(text: string): boolean {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return false;
    return lines.every(l => /^\s*[\u2800-\u28FF]/.test(l));
  }

  private cancelPendingPermissionRequests(): void {
    const pendingRequests = [...this.pendingPermissionRequests];
    this.pendingPermissionRequests.clear();

    for (const resolve of pendingRequests) {
      resolve({
        outcome: {
          outcome: 'cancelled',
        },
      });
    }
  }

  /**
   * 연결된 Agent 프록시를 반환합니다.
   */
  private getAgent(): Agent {
    if (!this.agentProxy) {
      throw new Error('ACP 연결이 설정되지 않았습니다');
    }
    return this.agentProxy;
  }

  /**
   * 고정 타임아웃: 지정 시간 내에 Promise가 완료되지 않으면 에러를 발생시킵니다.
   * connect, loadSession, cancel 등 제어 RPC에서 사용합니다.
   */
  private async withFixedTimeout<T>(
    promise: Promise<T> | undefined,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    if (!promise) {
      throw new Error(`${label}를 지원하지 않는 에이전트입니다`);
    }

    if (timeoutMs <= 0) {
      return promise;
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${label} 요청이 ${timeoutMs}ms 내에 완료되지 않았습니다`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error: unknown) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 유휴 타임아웃 래핑 (standalone 함수 위임).
   */
  private createIdleTimeoutRace<T>(
    promise: Promise<T>,
    idleMs: number,
    label: string,
  ): [Promise<T>, keepAlive: () => void] {
    return createIdleTimeoutRace(promise, idleMs, label);
  }
}

// ─── standalone 유틸 (테스트 가능) ──────────────────────

/**
 * 유휴 타임아웃 래핑: 스트리밍 활동이 없으면 idleMs 후 타임아웃.
 * keepAlive()를 호출할 때마다 타이머가 리셋됩니다.
 *
 * @param promise  감시할 Promise
 * @param idleMs   유휴 타임아웃 (ms). 0 이하이면 비활성화
 * @param label    에러 메시지 라벨
 * @returns [wrappedPromise, keepAlive]
 */
export function createIdleTimeoutRace<T>(
  promise: Promise<T>,
  idleMs: number,
  label: string,
): [Promise<T>, keepAlive: () => void] {
  if (idleMs <= 0) {
    return [promise, () => {}];
  }

  let timeoutId: ReturnType<typeof setTimeout>;
  let rejectFn: ((reason: Error) => void) | null = null;
  let settled = false;

  const resetTimer = () => {
    if (settled) return;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      if (!settled && rejectFn) {
        settled = true;
        rejectFn(new Error(
          `${label} 요청이 ${idleMs}ms 동안 스트리밍 활동 없이 유휴 상태입니다`,
        ));
      }
    }, idleMs);
  };

  const wrapped = new Promise<T>((resolve, reject) => {
    rejectFn = reject;
    resetTimer();

    promise
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
      })
      .catch((error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      });
  });

  return [wrapped, resetTimer];
}
