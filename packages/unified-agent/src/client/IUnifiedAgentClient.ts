/**
 * IUnifiedAgentClient - 통합 에이전트 클라이언트 공개 인터페이스
 *
 * UnifiedAgentClient가 외부에 노출하는 API 계약을 정의합니다.
 * 이벤트 맵, 연결 결과, public 메서드 시그니처를 포함합니다.
 */

import type { PromptResponse, McpServer } from '@agentclientprotocol/sdk';

import type {
  CliType,
  ProtocolType,
  ConnectionOptions,
  UnifiedClientOptions,
  CliDetectionResult,
  AgentMode,
  PreSpawnedHandle,
} from '../types/config.js';
import type {
  AcpAvailableCommand,
  AcpSessionNewResult,
  AcpContentBlock,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
  AcpToolCall,
  AcpToolCallUpdate,
} from '../types/acp.js';
import type { ConnectionState } from '../types/common.js';
import type { ProviderModelInfo } from '../models/schemas.js';

// ─── 이벤트 맵 ────────────────────────────────────────────

/** 통합 클라이언트 이벤트 맵 */
export interface UnifiedClientEvents {
  /** 연결 상태 변경 */
  stateChange: [state: ConnectionState];
  /** 사용자 메시지 청크 (스트리밍) */
  userMessageChunk: [text: string, sessionId: string];
  /** AI 응답 텍스트 청크 (스트리밍) */
  messageChunk: [text: string, sessionId: string];
  /** AI 사고 과정 청크 */
  thoughtChunk: [text: string, sessionId: string];
  /** 도구 호출 */
  toolCall: [title: string, status: string, sessionId: string, data?: AcpToolCall];
  /** 도구 호출 업데이트 */
  toolCallUpdate: [title: string, status: string, sessionId: string, data?: AcpToolCallUpdate];
  /** 계획 업데이트 */
  plan: [plan: string, sessionId: string];
  /** 사용 가능한 커맨드 목록 업데이트 */
  availableCommandsUpdate: [commands: AcpAvailableCommand[], sessionId: string];
  /** ACP 세션 업데이트 (원자적) */
  sessionUpdate: [update: AcpSessionUpdateParams];
  /** ACP 권한 요청 (콜백 기반 응답) */
  permissionRequest: [params: AcpPermissionRequestParams, resolve: (response: AcpPermissionResponse) => void];
  /** 파일 읽기 요청 (콜백 기반 응답) */
  fileRead: [params: AcpFileReadParams, resolve: (response: AcpFileReadResponse) => void];
  /** 파일 쓰기 요청 (콜백 기반 응답) */
  fileWrite: [params: AcpFileWriteParams, resolve: (response: AcpFileWriteResponse) => void];
  /** 프롬프트 완료 */
  promptComplete: [sessionId: string];
  /** 에러 */
  error: [error: Error];
  /** 프로세스 종료 */
  exit: [code: number | null, signal: string | null];
  /** 로그 */
  log: [message: string];
}

// ─── 연결 결과 ────────────────────────────────────────────

/** 연결 결과 */
export interface ConnectResult {
  /** 사용한 CLI */
  cli: CliType;
  /** 사용한 프로토콜 */
  protocol: ProtocolType;
  /** ACP 세션 정보 */
  session?: AcpSessionNewResult;
}

// ─── 연결 정보 ────────────────────────────────────────────

/** 연결 정보 */
export interface ConnectionInfo {
  /** 현재 연결된 CLI */
  cli: CliType | null;
  /** 현재 사용 중인 프로토콜 */
  protocol: ProtocolType | null;
  /** 현재 ACP 세션 ID */
  sessionId: string | null;
  /** 연결 상태 */
  state: ConnectionState;
}

// ─── 클라이언트 인터페이스 ──────────────────────────────────

/**
 * 통합 에이전트 클라이언트 인터페이스.
 * CLI 자동 감지, ACP 프로토콜 추상화, 이벤트 기반 스트리밍을 제공합니다.
 */
export interface IUnifiedAgentClient {
  /**
   * 이벤트 리스너를 등록합니다.
   *
   * @param event - 이벤트 이름
   * @param listener - 이벤트 리스너
   */
  on<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this;

  /**
   * 한 번만 실행되는 이벤트 리스너를 등록합니다.
   *
   * @param event - 이벤트 이름
   * @param listener - 이벤트 리스너
   */
  once<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this;

  /**
   * 이벤트 리스너를 해제합니다.
   *
   * @param event - 이벤트 이름
   * @param listener - 이벤트 리스너
   */
  off<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this;

  // ─── 연결 관리 ──────────────────────────────────────

  /**
   * CLI에 연결합니다.
   *
   * @param options - 연결 옵션
   * @returns 연결 결과
   */
  connect(options: UnifiedClientOptions): Promise<ConnectResult>;

  /**
   * 연결을 닫습니다.
   */
  disconnect(): Promise<void>;

  /**
   * 현재 세션을 종료합니다.
   * 프로세스는 유지되며 Pool에 반환하지 않습니다.
   * disconnect()와 달리 연결 자체는 유지됩니다.
   */
  endSession(): Promise<void>;

  /**
   * 연결 정보를 반환합니다.
   */
  getConnectionInfo(): ConnectionInfo;

  /**
   * 사용 가능한 CLI 목록을 감지합니다.
   */
  detectClis(): Promise<CliDetectionResult[]>;

  // ─── 메시지 ──────────────────────────────────────────

  /**
   * 메시지를 전송합니다.
   *
   * @param content - 메시지 내용 (텍스트 또는 ACP ContentBlock 배열)
   * @returns 프롬프트 처리 결과
   */
  sendMessage(content: string | AcpContentBlock[]): Promise<PromptResponse>;

  /**
   * 현재 진행 중인 프롬프트를 취소합니다.
   */
  cancelPrompt(): Promise<void>;

  // ─── 설정 변경 ──────────────────────────────────────

  /**
   * 모델을 변경합니다.
   *
   * @param model - 모델 이름
   */
  setModel(model: string): Promise<void>;

  /**
   * 세션 설정 옵션을 변경합니다.
   *
   * @param configId - 설정 옵션 ID
   * @param value - 설정 값
   */
  setConfigOption(configId: string, value: string): Promise<void>;

  /**
   * 에이전트 모드를 설정합니다.
   * CLI별 지원 모드: Gemini(default/autoEdit/yolo), Claude(default/plan/bypassPermissions), Codex(default/autoEdit/yolo) 등.
   *
   * @param mode - 모드 ID (e.g., 'plan', 'yolo', 'bypassPermissions')
   */
  setMode(mode: string): Promise<void>;

  /**
   * YOLO 모드를 설정합니다.
   * setMode()의 편의 래퍼입니다.
   *
   * @param enabled - 활성화 여부
   */
  setYoloMode(enabled: boolean): Promise<void>;

  /**
   * 현재 CLI에서 사용 가능한 에이전트 모드 목록을 반환합니다.
   *
   * @returns 모드 목록 (모드 미지원 시 빈 배열)
   */
  getAvailableModes(): AgentMode[];

  // ─── 모델 조회 ──────────────────────────────────────────

  /**
   * 사용 가능한 모델 목록을 정적 레지스트리에서 반환합니다.
   *
   * @param cli - CLI 타입 (생략 시 현재 연결된 CLI)
   * @returns 프로바이더 모델 정보 (연결 전이고 cli 미지정 시 null)
   */
  getAvailableModels(cli?: CliType): ProviderModelInfo | null;

  /**
   * 기존 세션을 로드합니다.
   *
   * @param sessionId - 로드할 세션 ID
   */
  loadSession(sessionId: string, mcpServers?: McpServer[]): Promise<void>;

  // ─── Pre-Spawn & 세션 교체 ─────────────────────────────

  /**
   * CLI 프로세스를 미리 스폰하고 opaque PreSpawnedHandle을 반환합니다.
   * connect() 시 preSpawned로 전달하면 spawn을 건너뛰고 세션 생성/로드만 수행합니다.
   *
   * @param cli - 스폰할 CLI 종류
   * @param options - 연결 옵션 (cwd 제외)
   * @returns 미리 스폰된 프로세스 핸들
   */
  preSpawn(cli: CliType, options?: Omit<ConnectionOptions, 'cwd'>): Promise<PreSpawnedHandle>;

  /**
   * 현재 프로세스를 유지한 채 세션만 교체합니다.
   * 현재 연결이 없으면 명확한 에러를 던집니다.
   * cwd 미지정 시 현재 sessionCwd를 재사용합니다.
   *
   * @param cwd - 새 세션의 작업 디렉토리 (선택, 미지정 시 현재 cwd 재사용)
   * @returns 연결 결과
   */
  resetSession(cwd?: string): Promise<ConnectResult>;
}
