/**
 * infra-settings/registry.ts — 섹션 표시 레지스트리
 *
 * 각 확장이 등록한 SectionDisplayConfig를 관리한다.
 */

import type { SectionDisplayConfig } from "./types.js";

/** 등록 순서 유지를 위한 Map */
const sections = new Map<string, SectionDisplayConfig>();

/** 섹션 등록 */
export function registerSection(config: SectionDisplayConfig): void {
  sections.set(config.key, config);
}

/** 섹션 해제 */
export function unregisterSection(key: string): void {
  sections.delete(key);
}

/** 등록된 모든 섹션 반환 (등록 순서 보존) */
export function getSections(): SectionDisplayConfig[] {
  return [...sections.values()];
}
