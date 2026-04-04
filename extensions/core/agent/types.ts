/**
 * fleet/internal/agent/types.ts — PI 비의존 실행 엔진 타입
 */

import type { CliType } from "@sbluemin/unified-agent";

// ─── 도구 호출 추적 ──────────────────────────────────────

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
  /** 명시적 reasoning effort */
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
