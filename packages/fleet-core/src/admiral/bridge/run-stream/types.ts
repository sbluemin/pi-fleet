/**
 * fleet/run-stream/types.ts — 스트리밍 도메인 타입 정의
 *
 * 스트리밍 블록, 칼럼 상태, 수집된 스트리밍 데이터 등
 * 스트리밍 계층의 핵심 타입을 정의합니다.
 *
 * ⚠️ 이 파일은 런타임 코드가 아닌 순수 타입/인터페이스만 포함합니다.
 */

export type {
  ColBlock,
  ColStatus,
  CollectedStreamData,
} from "../../../services/agent/types.js";

export type PanelJobKind = "sortie" | "squadron" | "taskforce";

export type PanelJobStatus = "active" | "done" | "error" | "aborted";
