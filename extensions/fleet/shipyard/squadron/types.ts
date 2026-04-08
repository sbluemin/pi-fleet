/**
 * fleet/shipyard/squadron/types.ts — Squadron 도구 타입 정의
 *
 * SubtaskProgress, SquadronResult, SquadronState 및 globalThis 키 상수를 정의합니다.
 */

// ─── 타입 정의 ──────────────────────────────────────────

/** 개별 서브태스크 진행 상태 */
export interface SubtaskProgress {
  status: "queued" | "connecting" | "streaming" | "done" | "error";
  /** 도구 호출 수 */
  toolCallCount: number;
  /** 응답 라인 수 */
  lineCount: number;
}

/** 개별 서브태스크 실행 결과 */
export interface SquadronResult {
  /** 서브태스크 인덱스 (0-based) */
  index: number;
  /** 서브태스크 식별명 */
  title: string;
  /** 최종 상태 */
  status: "done" | "error" | "aborted";
  /** 응답 텍스트 */
  responseText: string;
  /** 에러 메시지 */
  error?: string;
  /** 사고 과정 텍스트 */
  thinking?: string;
  /** 도구 호출 목록 */
  toolCalls?: { title: string; status: string }[];
}

/** Squadron 실행 중 상태 (실행 중에만 globalThis에 존재) */
export interface SquadronState {
  /** 선택된 캐리어 ID */
  carrierId: string;
  /** 동일 carrier의 다른 호출과 구분하기 위한 요청 키 */
  requestKey: string;
  /** index → 진행 상태 */
  subtasks: Map<number, SubtaskProgress>;
  /** 서브태스크 제목 목록 (렌더링용) */
  subtaskTitles: string[];
  /** 애니메이션 프레임 카운터 */
  frame: number;
  /** 프레임 타이머 */
  timer: ReturnType<typeof setInterval> | null;
}

// ─── 상수 ───────────────────────────────────────────────

/** 최대 동시 인스턴스 수 (하드 캡) */
export const SQUADRON_MAX_INSTANCES = 10;

/** globalThis 진행 상태 키 */
export const SQUADRON_STATE_KEY = "__pi_carrier_squadron_state__";

/** globalThis 결과 캐시 키 */
export const SQUADRON_RESULT_CACHE_KEY = "__pi_carrier_squadron_result_cache__";
