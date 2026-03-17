/**
 * unified-agent-core — 공용 타입 정의
 *
 * PI API 타입을 절대 import하지 않는 순수 SDK 타입입니다.
 */

export type { CliType } from "@sbluemin/unified-agent";

// ─── 도구 호출 추적 ──────────────────────────────────────

/** 도구 호출 추적 정보 */
export interface ToolCallInfo {
  /** 도구 호출 제목 (ACP 프로토콜의 title 필드) */
  title: string;
  /** 도구 호출 상태 (e.g., "running", "complete", "error") */
  status: string;
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

// ─── 실행 옵션/결과 ──────────────────────────────────────

/** executeWithPool / executeOneShot 공통 옵션 — sessionId 필드 없음 */
export interface ExecuteOptions {
  /** CLI 타입 (claude, codex, gemini) */
  cli: import("@sbluemin/unified-agent").CliType;
  /** 사용자 요청 텍스트 */
  request: string;
  /** 작업 디렉토리 */
  cwd: string;
  /** 설정 파일 디렉토리 (selected-models.json 등) */
  configDir: string;
  /** 취소 시그널 */
  signal?: AbortSignal;
  /** 메시지 청크 스트리밍 콜백 */
  onMessageChunk?: (text: string) => void;
  /** 사고 과정 청크 스트리밍 콜백 */
  onThoughtChunk?: (text: string) => void;
  /** 도구 호출 콜백 */
  onToolCall?: (title: string, status: string) => void;
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
  /** 연결 정보 */
  connectionInfo: ConnectionInfo;
  /** 최종 상태 */
  status: AgentStatus;
  /** 에러 메시지 (status === "error" 시) */
  error?: string;
}

// ─── 모델 선택 설정 ──────────────────────────────────────

/** 각 CLI별 모델 선택 설정 */
export interface ModelSelection {
  /** 선택된 모델 ID */
  model: string;
  /** Direct 모드 사용 여부 (codex 전용, ACP 우회) */
  direct?: boolean;
  /** Reasoning effort (codex, claude — SDK의 reasoningEffort.levels 기반) */
  effort?: string;
  /** Claude thinking budget_tokens (effort가 none이 아닐 때 사용) */
  budgetTokens?: number;
}

/** selected-models.json 전체 구조 */
export type SelectedModelsConfig = Record<string, ModelSelection>;

// ─── 프로바이더 정보 ─────────────────────────────────────

/** 프로바이더 모델 정보 */
export interface ProviderInfo {
  name: string;
  defaultModel: string;
  models: Array<{ modelId: string; name: string }>;
  reasoningEffort: { supported: boolean; levels?: string[]; default?: string };
}
