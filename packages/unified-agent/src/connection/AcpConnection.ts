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
  type PromptResponse,
  type ContentBlock,
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
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConnectionState } from '../types/common.js';
import type { AcpToolCall, AcpToolCallUpdate } from '../types/acp.js';
import { BaseConnection, type BaseConnectionOptions } from './BaseConnection.js';

/** AcpConnection 생성 옵션 */
export interface AcpConnectionOptions extends BaseConnectionOptions {
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
}

type AcpConnectionEvents = BaseConnectionEventMap & AcpConnectionEventMap;

/**
 * ACP 프로토콜 연결 클래스.
 * 공식 ACP SDK의 ClientSideConnection을 래핑하여 통합 이벤트 인터페이스를 제공합니다.
 */
export class AcpConnection extends BaseConnection {
  private readonly clientInfo: { name: string; version: string };
  private readonly protocolVersion: number;
  private readonly autoApprove: boolean;
  private agentProxy: Agent | null = null;
  private readonly pendingPermissionRequests = new Set<(
    response: RequestPermissionResponse,
  ) => void>();

  constructor(options: AcpConnectionOptions) {
    super(options);
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
   * ACP 연결을 시작합니다.
   * 프로세스 spawn → ClientSideConnection 생성 → initialize → 세션 생성까지 수행합니다.
   *
   * @param workspace - 작업 디렉토리 경로
   * @returns 세션 정보
   */
  async connect(workspace: string, sessionId?: string): Promise<NewSessionResponse> {
    // 1. 프로세스 spawn + Web Streams 생성
    const { stream } = this.spawnProcess();
    this.setState('initializing');

    // 2. ClientSideConnection 생성 (Client 인터페이스 구현)
    const connection = new ClientSideConnection(
      (agent: Agent): Client => {
        // Agent 참조 저장 (나중에 RPC 호출용)
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

    try {
      // 3. initialize 요청 (공식 SDK 타입: clientCapabilities, clientInfo)
      await this.withTimeout(
        agent.initialize({
          protocolVersion: this.protocolVersion,
          clientCapabilities,
          clientInfo: this.clientInfo,
        }),
        this.initTimeout,
        'initialize',
      );

      // 4. 세션 생성 또는 기존 세션 로드
      let session: NewSessionResponse;
      if (sessionId) {
        if (!agent.loadSession) {
          throw new Error('연결된 에이전트가 session/load를 지원하지 않습니다');
        }
        const loadResult = await this.withTimeout(
          agent.loadSession({ sessionId, cwd: workspace, mcpServers: [] }),
          this.initTimeout,
          'session/load',
        );
        // LoadSessionResponse에 sessionId를 합쳐 NewSessionResponse와 구조적 동일성 보장
        session = { ...loadResult, sessionId } as LoadSessionResponse & NewSessionResponse;
      } else {
        session = await this.withTimeout(
          agent.newSession({
            cwd: workspace,
            mcpServers: [],
          }),
          this.initTimeout,
          'session/new',
        );
      }

      this.setState('ready');
      return session;
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

    return this.withTimeout(
      agent.loadSession(params),
      this.requestTimeout,
      'session/load',
    );
  }

  override async disconnect(): Promise<void> {
    this.cancelPendingPermissionRequests();
    await super.disconnect();
  }

  /**
   * 메시지를 전송합니다.
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

    const response = await this.withTimeout(
      agent.prompt({
        sessionId,
        prompt,
      }),
      this.requestTimeout,
      'session/prompt',
    );

    this.emit('promptComplete', sessionId);
    return response;
  }

  /**
   * 현재 세션의 진행 중인 프롬프트를 취소합니다.
   *
   * @param sessionId - 세션 ID
   */
  async cancelSession(sessionId: string): Promise<void> {
    const agent = this.getAgent();
    this.cancelPendingPermissionRequests();
    await this.withTimeout(
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
    await this.withTimeout(
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
      await this.withTimeout(
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
    await this.withTimeout(
      agent.setSessionConfigOption?.({ sessionId, configId, value }),
      this.requestTimeout,
      'session/set_config_option',
    );
  }

  /**
   * Client 인터페이스 구현체를 생성합니다.
   * Agent → Client 방향의 요청/알림을 이벤트로 전파합니다.
   */
  private createClientHandler(): Client {
    return {
      // 권한 요청 처리
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
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

      default:
        break;
    }
  }

  /**
   * ContentChunk에서 텍스트 청크를 추출하여 해당 이벤트로 전파합니다.
   */
  private emitTextChunk(
    event: 'userMessageChunk' | 'messageChunk' | 'thoughtChunk',
    update: Extract<SessionUpdate, { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk' }>,
    sessionId: string,
  ): void {
    if (this.isTextContent(update.content)) {
      this.emit(event, update.content.text, sessionId);
    }
  }

  /**
   * ContentBlock이 텍스트 블록인지 판별합니다.
   */
  private isTextContent(content: ContentBlock): content is Extract<ContentBlock, { type: 'text' }> {
    return content.type === 'text' && typeof content.text === 'string';
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
   * 지정 시간 내에 Promise가 완료되지 않으면 타임아웃 에러를 발생시킵니다.
   */
  private async withTimeout<T>(
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
}
