/**
 * infra-experimental/types.ts — API 인터페이스 및 타입 정의
 *
 * globalThis 키와 bridge interface를 이 파일에서 정의한다.
 * (AGENTS.md: "globalThis key와 bridge interface는 소유 확장의 types.ts에 정의")
 */

/** globalThis 브릿지 키 */
export const INFRA_EXPERIMENTAL_KEY = "__infra_experimental__";

/** experimental 상태 */
export interface ExperimentalStatus {
  /** pi settings.json의 extensions 배열에 experimental/ 경로가 있으면 true */
  enabled: boolean;
  /** experimental/ 하위 유효 확장 수 (index.ts 보유 디렉토리) */
  extensionCount: number;
  /** 경로는 있는데 디렉토리가 없거나, 로드 실패 상태 */
  mismatch: boolean;
}

/** infra-experimental이 globalThis를 통해 제공하는 API */
export interface InfraExperimentalAPI {
  /** 현재 experimental 상태 조회 */
  getStatus(): ExperimentalStatus;
}
