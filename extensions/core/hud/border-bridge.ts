/**
 * core-hud/border-bridge.ts — 에디터 테두리 색상 globalThis 브릿지
 *
 * 외부 확장에서 에디터 테두리 색상을 동적으로 제어할 수 있도록
 * globalThis 키 기반 set/get 인터페이스를 제공한다.
 */

// ── 상수 ──

const KEY = "__pi_hud_editor_border_color__";

// ── 함수 ──

/** 에디터 테두리 색상을 ANSI 코드로 설정 (null이면 기본 sep 색상 사용) */
export function setEditorBorderColor(ansiCode: string | null): void {
  (globalThis as any)[KEY] = ansiCode;
}

/** 현재 설정된 에디터 테두리 색상 ANSI 코드를 반환 (미설정 시 null) */
export function getEditorBorderColor(): string | null {
  return (globalThis as any)[KEY] ?? null;
}
