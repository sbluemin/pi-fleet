/**
 * core/contracts.ts — 코어 계층 중립 계약 타입 정의
 *
 * streaming, render, panel, status 등 여러 하위 모듈이 공유하는
 * 도메인 타입을 한 곳에 모아 순환 의존과 계층 위반을 방지합니다.
 *
 * ⚠️ 이 파일은 런타임 코드가 아닌 순수 타입/인터페이스만 포함합니다.
 *    구현 로직이나 외부 모듈 import를 추가하지 마세요.
 */

import type { AgentStatus } from "./agent/types.js";

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

/** 에이전트 패널 칼럼 데이터 */
export interface AgentCol {
  cli: string;
  sessionId?: string;
  /** 순서 있는 이벤트 로그 (도구 호출 + 응답 텍스트 혼합) */
  blocks: ColBlock[];
  /** thinking/추론 텍스트 — 하위 호환용 누적 상태 */
  thinking: string;
  // 하위 호환 및 CollectedStreamData 공급용 (blocks에서 파생)
  text: string;
  toolCalls: { title: string; status: string }[];
  status: ColStatus;
  error?: string;
  scroll: number;
}

// ─── 수집된 스트리밍 데이터 ──────────────────────────────

/** 수집된 스트리밍 데이터 (하위 호환 — mirror.ts의 CollectedStreamData 대체) */
export interface CollectedStreamData {
  text: string;
  thinking: string;
  toolCalls: { title: string; status: string }[];
  blocks: ColBlock[];
  lastStatus: AgentStatus;
}

// ─── 서비스 상태 타입 ────────────────────────────────────

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

// ─── 서비스 상태 렌더러 콜백 ─────────────────────────────

/**
 * 서비스 상태 토큰 렌더러 함수 시그니처.
 * core → feature 역방향 의존을 방지하기 위해
 * feature(status)에서 구현하고 core(panel)에 주입합니다.
 *
 * widget-sync가 호출 시 현재 state의 snapshots/loading을 전달하므로
 * 구현부는 상태 접근 없이 순수 렌더링만 수행합니다.
 */
export type ServiceStatusRendererFn = (
  cli: string,
  snapshots: ServiceSnapshot[],
  loading: boolean,
) => string | undefined;
