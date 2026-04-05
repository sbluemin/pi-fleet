/**
 * infra-settings/bridge.ts — globalThis 런타임 브릿지
 *
 * types.ts에서 분리된 런타임 로직을 포함한다.
 * - 섹션 레지스트리 globalThis 초기화
 * - _getSectionsMap() 함수 (registry.ts 내부용)
 * - getSettingsAPI() 헬퍼 (외부 소비자 유일 진입점)
 *
 * globalThis 키 상수는 types.ts에 정의 (AGENTS.md 규칙 준수)
 */

export { INFRA_SETTINGS_KEY } from "./types.js";
import { INFRA_SETTINGS_KEY } from "./types.js";
import type { InfraSettingsAPI, SectionDisplayConfig } from "./types.js";

// ── 상수 ──

/** @internal globalThis에 섹션 레지스트리를 보관하는 키 */
const _SECTIONS_KEY = "__infra_settings_sections__";

// ── globalThis에 섹션 레지스트리 보관 (모듈 재로드 시 유실 방지) ──
// 가드: 이미 등록되어 있으면 덮어쓰지 않는다.

if (!(globalThis as any)[_SECTIONS_KEY]) {
  (globalThis as any)[_SECTIONS_KEY] = new Map<string, SectionDisplayConfig>();
}

// ── 함수 ──

/** 외부 소비자가 안전하게 settings API에 접근하는 유일한 진입점 */
export function getSettingsAPI(): InfraSettingsAPI | undefined {
  return (globalThis as any)[INFRA_SETTINGS_KEY];
}

/** @internal registry.ts에서 사용 — globalThis에 보관된 섹션 Map 접근 */
export function _getSectionsMap(): Map<string, SectionDisplayConfig> {
  return (globalThis as any)[_SECTIONS_KEY];
}
