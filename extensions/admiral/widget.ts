/**
 * admiral/widget — 프로토콜 상태 aboveEditor 위젯
 *
 * 활성 프로토콜의 shortLabel을 입력창 위에 표시한다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getActiveProtocol } from "./protocols/index.js";

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const WIDGET_KEY = "admiral-protocol-status";
const ANSI_RESET = "\x1b[0m";

// ─────────────────────────────────────────────────────────
// 함수
// ─────────────────────────────────────────────────────────

/** 위젯 setWidget 호출 (등록 및 갱신 공용) */
function applyWidget(ctx: ExtensionContext): void {
  ctx.ui.setWidget(WIDGET_KEY, (_tui, _theme) => ({
    render(width: number): string[] {
      // 이제 Protocol 정보는 editor의 우측 하단 레이블로 표시되므로
      // aboveEditor 위젯은 빈 배열을 반환하여 공간을 차지하지 않도록 함.
      return [];
    },
    invalidate() {},
  }), { placement: "aboveEditor" });
}

/** 위젯 등록 */
export function registerProtocolWidget(ctx: ExtensionContext): void {
  applyWidget(ctx);
}

/** 상태 변경 시 위젯 갱신 */
export function updateProtocolWidget(ctx: ExtensionContext): void {
  applyWidget(ctx);
}
