/**
 * core-hud/border-bridge.ts — 에디터 테두리 색상 및 레이블 globalThis 브릿지
 *
 * 외부 확장에서 에디터 테두리 색상과 우측 하단 레이블을 동적으로 제어할 수 있도록
 * globalThis 키 기반 set/get 인터페이스를 제공한다.
 */

// ── 상수 ──

const COLOR_KEY = "__pi_hud_editor_border_color__";
const LABEL_KEY = "__pi_hud_editor_right_label__";

// ── 함수 ──

/** 에디터 테두리 색상을 ANSI 코드로 설정 (null이면 기본 sep 색상 사용) */
export function setEditorBorderColor(ansiCode: string | null): void {
  (globalThis as any)[COLOR_KEY] = ansiCode;
}

/** 현재 설정된 에디터 테두리 색상 ANSI 코드를 반환 (미설정 시 null) */
export function getEditorBorderColor(): string | null {
  return (globalThis as any)[COLOR_KEY] ?? null;
}

/** 에디터 테두리 우측 하단에 표시할 레이블(ANSI 포함)을 설정 */
export function setEditorRightLabel(label: string | null): void {
  (globalThis as any)[LABEL_KEY] = label;
}

/** 현재 설정된 에디터 테두리 우측 하단 레이블을 반환 */
export function getEditorRightLabel(): string | null {
  return (globalThis as any)[LABEL_KEY] ?? null;
}
