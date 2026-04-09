/**
 * core/claude-provider — 공유 타입 및 상수 정의
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/** MCP tool 결과 — pi tool 실행 결과를 SDK에 반환할 때 사용 */
export interface McpResult {
  content: McpContent;
  isError?: boolean;
  [key: string]: unknown;
}

/** MCP content block 타입 */
export type McpContent = McpContentBlock[];

export interface McpContentBlock {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

/** FIFO 대기열에서 pending tool call을 관리할 때 사용 */
export interface PendingToolCall {
  toolName: string;
  resolve: (result: McpResult) => void;
}

/** 공유 세션 상태 — cc-session-io resume에 사용 */
export interface SharedSession {
  sessionId: string;
  cursor: number;
  cwd: string;
  lastSystemPromptHash?: string;
}

/** provider 전역 상태 — globalThis에 저장하여 module reload에도 유지 */
export interface FleetCcState {
  activeQuery: ReturnType<typeof import("@anthropic-ai/claude-agent-sdk").query> | null;
  currentPiStream: ReturnType<typeof import("@mariozechner/pi-ai").createAssistantMessageEventStream> | null;
  sharedSession: SharedSession | null;
  pendingToolCalls: PendingToolCall[];
  pendingResults: McpResult[];
  turnOutput: AssistantMessage;
  queryStateStack: SavedQueryState[];
}

/** reentrant query 시 부모 상태를 저장하는 구조 */
export interface SavedQueryState {
  activeQuery: FleetCcState["activeQuery"];
  currentPiStream: FleetCcState["currentPiStream"];
  pendingToolCalls: PendingToolCall[];
  pendingResults: McpResult[];
}

/** pi tool → SDK tool name 매핑 */
export type ToolNameMap = Map<string, string>;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Provider 식별자 */
export const PROVIDER_ID = "Fleet CC";

/** MCP 서버 이름 — Claude에 노출되는 tool prefix */
export const MCP_SERVER_NAME = "pi-tools";

/** globalThis 키 — module reload 시 상태 보존 */
export const GLOBAL_STATE_KEY = "__pi_fleet_cc_state__";

/** globalThis 키 — 활성 streamSimple 함수 참조 (subagent 중복 등록 방지) */
export const ACTIVE_STREAM_KEY = "__pi_fleet_cc_stream__";

/** 최신 모델 ID 필터 */
export const LATEST_MODEL_IDS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
]);

/** reasoning level → SDK effort 매핑 */
export const REASONING_TO_EFFORT: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
};

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

/** systemPrompt 해시 생성 — drift 감지용 */
export function hashSystemPrompt(prompt: string | undefined): string {
  if (!prompt) return "";
  // 간단한 djb2 해시
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** globalThis에서 상태를 가져오거나 초기화 */
export function getOrInitState(): FleetCcState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_STATE_KEY]) {
    g[GLOBAL_STATE_KEY] = createInitialState();
  }
  return g[GLOBAL_STATE_KEY] as FleetCcState;
}

/** 초기 상태 생성 */
function createInitialState(): FleetCcState {
  return {
    activeQuery: null,
    currentPiStream: null,
    sharedSession: null,
    pendingToolCalls: [],
    pendingResults: [],
    turnOutput: null as unknown as AssistantMessage,
    queryStateStack: [],
  };
}
