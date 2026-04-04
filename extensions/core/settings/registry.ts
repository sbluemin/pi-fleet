/**
 * infra-settings/registry.ts — 섹션 표시 레지스트리
 *
 * 각 확장이 등록한 SectionDisplayConfig를 관리한다.
 * 섹션 Map은 globalThis에 보관하여 모듈 재로드 시 유실을 방지한다.
 */

import { _getSectionsMap } from "./types.js";
import type { SectionDisplayConfig } from "./types.js";

/** 섹션 등록 */
export function registerSection(config: SectionDisplayConfig): void {
  _getSectionsMap().set(config.key, config);
}

/** 섹션 해제 */
export function unregisterSection(key: string): void {
  _getSectionsMap().delete(key);
}

/** 등록된 모든 섹션 반환 (등록 순서 보존) */
export function getSections(): SectionDisplayConfig[] {
  return [..._getSectionsMap().values()];
}
