/**
 * unified-agent-direct/types.ts — 공개 타입 및 globalThis 브릿지 정의
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import type { AgentStatus } from "./core/agent/types.js";
import type { CollectedStreamData } from "./core/contracts.js";

/** globalThis 공개 브릿지 키 */
export const UNIFIED_AGENT_REQUEST_KEY = "__pi_ua_request__";

/** requestUnifiedAgent에서 허용하는 최종 상태 */
export type UnifiedAgentRequestStatus = Extract<AgentStatus, "done" | "error" | "aborted">;

/** 공개 API 입력 옵션 */
export interface UnifiedAgentRequestOptions {
  /** 대상 에이전트 */
  cli: CliType;
  /** 에이전트에게 전달할 요청 */
  request: string;
  /** 위젯 렌더링과 기본 cwd 해석에 사용할 컨텍스트 */
  ctx: ExtensionContext;
  /** 취소 시그널 */
  signal?: AbortSignal;
  /** 작업 디렉토리 강제 지정 */
  cwd?: string;
  /** 메시지 청크 추가 후 호출되는 훅 */
  onMessageChunk?: (text: string) => void;
  /** 사고 청크 추가 후 호출되는 훅 */
  onThoughtChunk?: (text: string) => void;
  /** 도구 호출 블록 갱신 후 호출되는 훅 */
  onToolCall?: (
    title: string,
    status: string,
    rawOutput?: string,
    toolCallId?: string,
  ) => void;
}

/** 공개 API 반환 결과 */
export interface UnifiedAgentResult {
  /** 실행 최종 상태 */
  status: UnifiedAgentRequestStatus;
  /** 에이전트 최종 응답 텍스트 */
  responseText: string;
  /** 세션 ID */
  sessionId?: string;
  /** 오류 메시지 */
  error?: string;
  /** 누적된 사고 텍스트 */
  thinking?: CollectedStreamData["thinking"];
  /** 누적된 도구 호출 목록 */
  toolCalls?: CollectedStreamData["toolCalls"];
  /** 누적된 렌더링 블록 */
  blocks?: CollectedStreamData["blocks"];
}

/**
 * globalThis로 노출되는 공개 브릿지.
 *
 * 동일 CLI에 대한 동시 호출 시 stream-store 기록과 패널 칼럼이
 * 인터리브될 수 있으므로, 같은 CLI에 대해서는 직렬 호출을 권장합니다.
 */
export interface UnifiedAgentRequestBridge {
  requestUnifiedAgent(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
}
