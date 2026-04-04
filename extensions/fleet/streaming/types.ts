/**
 * fleet/streaming/types.ts — 스트리밍 도메인 타입 정의
 *
 * 스트리밍 블록, 칼럼 상태, 수집된 스트리밍 데이터 등
 * 스트리밍 계층의 핵심 타입을 정의합니다.
 *
 * ⚠️ 이 파일은 런타임 코드가 아닌 순수 타입/인터페이스만 포함합니다.
 */

import type { AgentStatus } from "../../core/agent/types.js";

// ─── 스트리밍 블록 타입 ──────────────────────────────────

/**
 * 순서가 보존된 이벤트 블록.
 * 도구 호출과 응답 텍스트를 발생 순서대로 기록합니다.
 */
export type ColBlock =
  | { type: "thought"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; title: string; status: string; toolCallId?: string };

// ─── 칼럼 상태 타입 ──────────────────────────────────────

/** 칼럼(또는 run) 상태 */
export type ColStatus = "wait" | "conn" | "stream" | "done" | "err";

// ─── 수집된 스트리밍 데이터 ──────────────────────────────

/** 수집된 스트리밍 데이터 (하위 호환 — mirror.ts의 CollectedStreamData 대체) */
export interface CollectedStreamData {
  text: string;
  thinking: string;
  toolCalls: { title: string; status: string }[];
  blocks: ColBlock[];
  lastStatus: AgentStatus;
}
