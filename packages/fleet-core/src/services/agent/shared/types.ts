/**
 * fleet/internal/agent/types.ts — PI 비의존 실행 엔진 타입
 */

// ─── 도구 호출 추적 ──────────────────────────────────────

export type CliType = "claude" | "codex" | "gemini";

/** 도구 호출 추적 정보 */
export interface ToolCallInfo {
  /** 도구 호출 제목 (ACP 프로토콜의 title 필드) */
  title: string;
  /** 도구 호출 상태 (e.g., "running", "complete", "error") */
  status: string;
  /** 도구 결과 텍스트 (content/rawOutput를 평탄화한 문자열) */
  rawOutput?: string;
  /** 도구 호출 고유 ID (toolCallId 기반 추적용) */
  toolCallId?: string;
  /** 타임스탬프 */
  timestamp: number;
}

// ─── 연결 정보 ───────────────────────────────────────────

/** 연결 후 반환되는 메타 정보 */
export interface ConnectionInfo {
  protocol?: string;
  sessionId?: string;
  model?: string;
}

// ─── 에이전트 상태 ───────────────────────────────────────

/** 에이전트 실행 상태 */
export type AgentStatus = "connecting" | "running" | "done" | "error" | "aborted";

// ─── 정규화 스트림 모델 ─────────────────────────────────

/**
 * 순서가 보존된 정규화 스트림 블록.
 * 도구 호출과 응답 텍스트를 발생 순서대로 기록합니다.
 */
export type ColBlock =
  | { type: "thought"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; title: string; status: string; toolCallId?: string };

/** 칼럼(또는 run) 상태 */
export type ColStatus = "wait" | "conn" | "stream" | "done" | "err";

/** 수집된 정규화 스트리밍 데이터 */
export interface CollectedStreamData {
  text: string;
  thinking: string;
  toolCalls: { title: string; status: string }[];
  blocks: ColBlock[];
  lastStatus: AgentStatus;
}

export type AgentStreamEndReason = "done" | "error" | "aborted";

export interface AgentStreamKey {
  readonly carrierId: string;
  readonly cli?: CliType;
  readonly requestId?: string;
}

export interface AgentStreamToolEvent {
  readonly type: "tool";
  readonly key: AgentStreamKey;
  readonly title: string;
  readonly status: string;
  readonly toolCallId?: string;
}

export type AgentStreamEvent =
  | {
    readonly type: "request_begin";
    readonly key: AgentStreamKey;
    readonly requestPreview?: string;
  }
  | {
    readonly type: "status";
    readonly key: AgentStreamKey;
    readonly status: AgentStatus;
  }
  | {
    readonly type: "message";
    readonly key: AgentStreamKey;
    readonly text: string;
  }
  | {
    readonly type: "thought";
    readonly key: AgentStreamKey;
    readonly text: string;
  }
  | AgentStreamToolEvent
  | {
    readonly type: "request_end";
    readonly key: AgentStreamKey;
    readonly reason: AgentStreamEndReason;
    readonly sessionId?: string;
    readonly responseText?: string;
    readonly thoughtText?: string;
    readonly streamData?: CollectedStreamData;
    readonly error?: string;
  }
  | {
    readonly type: "error";
    readonly key: AgentStreamKey;
    readonly message: string;
  };

// ─── 실행 옵션/결과 ──────────────────────────────────────

/** executeWithPool / executeOneShot 공통 옵션 */
export interface ExecuteOptions {
  /** 고유 carrier 식별자 — 풀 키, 세션 스토어 키 */
  carrierId: string;
  /** CLI 바이너리 타입 (claude, codex, gemini) — 실제 연결 대상 */
  cliType: CliType;
  /** 사용자 요청 텍스트 */
  request: string;
  /** 작업 디렉토리 */
  cwd: string;
  /** 명시적 모델 ID */
  model?: string;
  /**
   * Reasoning effort 레벨 (예: "low" | "medium" | "high").
   *
   * 시맨틱 (sticky):
   * - 명시 시: setConfigOption("reasoning_effort", value)로 세션에 적용하고 launch metadata에 저장.
   * - 미지정 시: 기존 세션/풀 엔트리의 값이 유지됨 (호출이 발생하지 않음).
   * - fresh reconnect 시: 명시 값이 없으면 보존된 launch metadata effort로 자동 폴백되어 재적용.
   * - 리셋이 필요하면 호출자가 명시적 레벨을 전달해야 함.
   * - CLI 지원 여부는 provider client의 fleet-core helper로 사전 검사되며,
   *   미지원 CLI에서는 호출 자체가 스킵됨.
   */
  effort?: string;
  /** 명시적 Claude thinking budget tokens */
  budgetTokens?: number;
  /** 프롬프트 유휴 타임아웃 (ms, 미지정 시 SDK 기본값 사용) */
  promptIdleTimeout?: number;
  /** 취소 시그널 */
  signal?: AbortSignal;
  /** 메시지 청크 스트리밍 콜백 */
  onMessageChunk?: (text: string) => void;
  /** 사고 과정 청크 스트리밍 콜백 */
  onThoughtChunk?: (text: string) => void;
  /** 도구 호출 콜백 */
  onToolCall?: (title: string, status: string, rawOutput?: string, toolCallId?: string) => void;
  /** 연결 완료 콜백 (연결 정보 전달) */
  onConnected?: (info: ConnectionInfo) => void;
  /** 상태 변경 콜백 */
  onStatusChange?: (status: AgentStatus) => void;
}

/** 실행 결과 */
export interface ExecuteResult {
  /** 에이전트 응답 텍스트 */
  responseText: string;
  /** 사고 과정 텍스트 */
  thoughtText: string;
  /** 도구 호출 목록 */
  toolCalls: ToolCallInfo[];
  /** 정규화된 스트림 데이터 */
  streamData: CollectedStreamData;
  /** 연결 정보 */
  connectionInfo: ConnectionInfo;
  /** 최종 상태 */
  status: AgentStatus;
  /** 에러 메시지 (status === "error" 시) */
  error?: string;
}

// ─── 서비스 상태 타입 ────────────────────────────────────────────────

/** 서비스 상태 프로바이더 키 */
export type ProviderKey = "claude" | "codex" | "gemini";

/** 서비스 헬스 상태 */
export type HealthStatus =
  | "operational"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

/** 서비스 상태 스냅샷 */
export interface ServiceSnapshot {
  provider: ProviderKey;
  label: string;
  status: HealthStatus;
  matchedTarget: string;
  sourceUrl: string;
  checkedAt: number;
  note?: string;
}
