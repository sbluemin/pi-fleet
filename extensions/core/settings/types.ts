/**
 * infra-settings/types.ts — API 인터페이스 및 표시 타입 정의
 *
 * globalThis 키와 브릿지 인터페이스를 이 파일에서 정의한다.
 * (AGENTS.md: "globalThis key와 bridge interface는 소유 확장의 types.ts에 정의")
 */

/** 팝업에 표시할 필드 하나 */
export interface DisplayField {
  label: string;
  value: string;
  /** theme 색상 이름 (e.g. "accent", "warning", "dim"). 기본값: "accent" */
  color?: string;
}

/** 섹션 표시 설정 — 각 확장이 등록 */
export interface SectionDisplayConfig {
  /** settings.json 키 — 확장 디렉토리 이름 (e.g. "utils-improve-prompt") */
  key: string;
  /** 팝업에 표시할 이름 (e.g. "Meta Prompt", "Auto Summarize") */
  displayName: string;
  /** 팝업이 열릴 때마다 호출 — 최신 상태의 필드 목록 반환 */
  getDisplayFields(): DisplayField[];
}

/** infra-settings가 globalThis를 통해 제공하는 API */
export interface InfraSettingsAPI {
  /** settings.json에서 특정 섹션 읽기 */
  load<T = Record<string, unknown>>(sectionKey: string): T;
  /** settings.json에 특정 섹션 저장 */
  save(sectionKey: string, data: unknown): void;
  /** 팝업 표시용 섹션 등록 */
  registerSection(config: SectionDisplayConfig): void;
  /** 팝업 표시용 섹션 해제 */
  unregisterSection(sectionKey: string): void;
}

/** globalThis 브릿지 키 */
export const INFRA_SETTINGS_KEY = "__infra_settings__";

// ── globalThis에 섹션 레지스트리 보관 (모듈 재로드 시 유실 방지) ──
// 가드: 이미 등록되어 있으면 덮어쓰지 않는다.
const _SECTIONS_KEY = "__infra_settings_sections__";
if (!(globalThis as any)[_SECTIONS_KEY]) {
  (globalThis as any)[_SECTIONS_KEY] = new Map<string, SectionDisplayConfig>();
}

/** @internal registry.ts에서 사용 — globalThis에 보관된 섹션 Map 접근 */
export function _getSectionsMap(): Map<string, SectionDisplayConfig> {
  return (globalThis as any)[_SECTIONS_KEY];
}
