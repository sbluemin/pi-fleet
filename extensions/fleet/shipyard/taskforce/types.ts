/**
 * fleet/shipyard/taskforce/types.ts — Task Force 도구 타입 정의
 *
 * BackendProgress, TaskForceResult, TaskForceState 및 globalThis 키 상수를 정의합니다.
 */

import type { CliType } from "@sbluemin/unified-agent";

// ─── 타입 정의 ──────────────────────────────────────────

export type TaskForceCliType = "claude" | "codex" | "gemini";

/** 개별 백엔드 진행 상태 */
export interface BackendProgress {
  status: "queued" | "connecting" | "streaming" | "done" | "error";
  /** 도구 호출 수 */
  toolCallCount: number;
  /** 응답 라인 수 */
  lineCount: number;
}

/** 개별 백엔드 실행 결과 */
export interface TaskForceResult {
  /** CLI 타입 (claude/codex/gemini) */
  cliType: TaskForceCliType;
  /** 표시 이름 (Claude/Codex/Gemini) */
  displayName: string;
  /** 최종 상태 */
  status: "done" | "error" | "aborted";
  /** 응답 텍스트 */
  responseText: string;
  /** 에러 메시지 (status === "error" 시) */
  error?: string;
  /** 사고 과정 텍스트 */
  thinking?: string;
  /** 도구 호출 목록 */
  toolCalls?: { title: string; status: string }[];
}

/** Task Force 실행 중 상태 (실행 중에만 globalThis에 존재) */
export interface TaskForceState {
  /** 선택된 캐리어 ID */
  carrierId: string;
  /** 동일 carrier의 다른 호출과 구분하기 위한 요청 키 */
  requestKey: string;
  /** cliType → 진행 상태 */
  backends: Map<TaskForceCliType, BackendProgress>;
  /** 애니메이션 프레임 카운터 */
  frame: number;
  /** 프레임 타이머 */
  timer: ReturnType<typeof setInterval> | null;
  /** 실행 시작 시각 (Date.now()) */
  startedAt: number;
  /** 모든 작업 완료 시각 */
  finishedAt?: number;
}

// ─── 상수 ───────────────────────────────────────────────

/** Task Force가 지원하는 전체 CLI 백엔드 후보군 (이 중 2개 이상 설정 시 편성 가능) */
export const TASKFORCE_CLI_TYPES = ["claude", "codex", "gemini"] as const satisfies readonly CliType[];

/** globalThis 진행 상태 키 */
export const TASKFORCE_STATE_KEY = "__pi_carrier_taskforce_state__";

/** globalThis 결과 캐시 키 */
export const TASKFORCE_RESULT_CACHE_KEY = "__pi_carrier_taskforce_result_cache__";
