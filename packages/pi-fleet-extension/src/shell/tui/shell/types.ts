/**
 * core-shell — 공용 타입
 *
 * 순수 쉘 팝업 유틸리티. 에이전트 개념 없음.
 */

/** 팝업 실행 결과 */
export interface ShellPopupResult {
  exitCode: number | null;
  signal?: number;
  cancelled: boolean;
}

/** 팝업 실행 옵션 — 명령어를 받아 PTY 팝업으로 띄움 */
export interface ShellPopupOptions {
  /** 실행할 쉘 명령어 */
  command: string;
  /** 팝업 타이틀 */
  title?: string;
  /** 작업 디렉토리 */
  cwd?: string;
}

export type PopupState = "interactive" | "exited";

/** globalThis 브릿지 키 */
export const SHELL_POPUP_BRIDGE_KEY = "__core_interactive_shell__";

export const HEADER_LINES = 4;
export const FOOTER_LINES = 2;
