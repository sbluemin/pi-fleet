/**
 * core-log/bridge.ts — globalThis 런타임 브릿지
 *
 * types.ts에서 분리된 런타임 로직을 포함한다.
 * - no-op 기본 API 초기화 (활성화 전 호출 안전)
 * - _bootstrapLog() 함수 (실제 구현 주입)
 * - getLogAPI() 헬퍼 (외부 소비자 유일 진입점)
 *
 * globalThis 키 상수는 types.ts에 정의 (AGENTS.md 규칙 준수)
 */

export { CORE_LOG_KEY } from "./types.js";
import { CORE_LOG_KEY } from "./types.js";
import type { CoreLogAPI, LogEntry } from "./types.js";

// ── globalThis에 no-op stub 등록 (모듈 재로드 시 유실 방지) ──
// 가드: 이미 등록되어 있으면 덮어쓰지 않는다.

if (!(globalThis as any)[CORE_LOG_KEY]) {
  const noop: CoreLogAPI = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    log() {},
    isEnabled: () => false,
    setEnabled() {},
    getRecentLogs: () => [],
  };
  (globalThis as any)[CORE_LOG_KEY] = noop;
}

// ── 함수 ──

/** 외부 소비자가 안전하게 log API에 접근하는 유일한 진입점 */
export function getLogAPI(): CoreLogAPI {
  return (globalThis as any)[CORE_LOG_KEY];
}

/** @internal register.ts에서 호출 — 실제 구현 주입 */
export function _bootstrapLog(impl: CoreLogAPI): void {
  (globalThis as any)[CORE_LOG_KEY] = impl;
}
