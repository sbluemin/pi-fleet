/**
 * fleet/panel/widget-sync.ts — PI TUI 위젯 브릿지
 *
 * 현재 상태에 맞게 aboveEditor 위젯을 등록/제거하고
 * footer 상태를 동기화합니다.
 *
 * lifecycle.ts에서 호출됩니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  PANEL_COLOR,
  MIN_BODY_H,
} from "../constants";
import {
  resolveCarrierColor,
} from "../shipyard/carrier/framework.js";
import {
  renderPanelFull,
} from "../render/panel-renderer";
import { renderFooterStatus } from "../shipyard/carrier/footer-renderer.js";
import { getState, makeFooterCols, WIDGET_KEY } from "./state.js";

/** footer 상태 전용 status key */
const UA_DIRECT_FOOTER_STATUS_KEY = "ua-direct-footer";

// ─── footer 동기화 ───────────────────────────────────────

/** 같은 이벤트 루프 턴의 footer 갱신 요청을 마지막 ctx 기준으로 합칩니다. */
let pendingFooterCtx: ExtensionContext | null = null;
let footerScheduled = false;

/**
 * footer 상태 동기화를 microtask로 예약합니다.
 * 스트리밍 청크처럼 고빈도 경로에서 여러 호출이 들어와도 1회만 flush합니다.
 */
export function scheduleSyncFooter(ctx: ExtensionContext | null): void {
  if (!ctx) return;
  pendingFooterCtx = ctx;
  if (footerScheduled) return;

  footerScheduled = true;
  queueMicrotask(() => {
    footerScheduled = false;
    const nextCtx = pendingFooterCtx;
    pendingFooterCtx = null;
    syncFooterStatus(nextCtx);
  });
}

/** footer 상태를 현재 패널 상태 기준으로 PI TUI에 반영합니다. */
export function syncFooterStatus(ctx: ExtensionContext | null): void {
  if (!ctx) return;
  const s = getState();
  const content = renderFooterStatus({
    cols: makeFooterCols(),
    streaming: s.streaming,
    frame: s.frame,
  });
  ctx.ui.setStatus(UA_DIRECT_FOOTER_STATUS_KEY, content);
}

// ─── 위젯 동기화 ────────────────────────────────────────

/**
 * 현재 상태에 맞게 aboveEditor 위젯을 등록/제거합니다.
 *
 * 렌더링 분기:
 * - expanded → aboveEditor 위젯으로 renderPanelFull 표시 (터미널 높이 기반 클램핑)
 * - !expanded → 위젯 제거 (배너는 core-hud/editor.ts에서 직접 렌더링)
 */
export function syncWidget(ctx: ExtensionContext): void {
  const s = getState();
  syncFooterStatus(ctx);

  // 패널 접힘 → 위젯 불필요 (배너는 에디터가 직접 렌더링)
  if (!s.expanded) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  ctx.ui.setWidget(WIDGET_KEY, (_tui, _theme) => ({
    render(width: number): string[] {
      const state = getState();
      const frameColor = state.activeMode
        ? (resolveCarrierColor(state.activeMode) || PANEL_COLOR)
        : PANEL_COLOR;

      // 터미널 높이 기반 bodyH 클램핑
      // 에디터(30%) + footer(2) + spacer/status 여유(5) 확보
      const termH = process.stdout.rows ?? 24;
      const reserved = Math.ceil(termH * 0.3) + 7;
      const maxBodyH = Math.max(MIN_BODY_H, termH - reserved);
      const effectiveBodyH = Math.min(state.bodyH, maxBodyH);

      return renderPanelFull(
        width, state.cols, state.frame, frameColor,
        state.bottomHint, state.activeMode, effectiveBodyH,
        state.cursorColumn,
      );
    },
    invalidate() {},
  }));
}
