/**
 * status/types.ts — 서비스 상태 모니터링 타입
 *
 * 공유 도메인 타입(ProviderKey, HealthStatus, ServiceSnapshot)은
 * core/index.ts(Facade)를 통해 접근합니다.
 * StatusStore는 status feature 전용 내부 타입입니다.
 */

// 공유 타입 re-export (core/index.ts Facade 경유)
export type { ProviderKey, HealthStatus, ServiceSnapshot } from "../core/index.js";

// feature 전용 내부 타입
export interface StatusStore {
  ctx: any | null;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  lastRefreshStartedAt: number;
  lastUpdatedAt: number | null;
  snapshots: import("../core/index.js").ServiceSnapshot[];
  /** provider별 마지막 확인 시각 (차등 폴링용) */
  providerLastChecked: Record<import("../core/index.js").ProviderKey, number>;
}
