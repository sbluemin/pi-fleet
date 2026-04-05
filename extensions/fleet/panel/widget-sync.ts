/**
 * fleet/panel/widget-sync.ts — PI TUI 위젯 동기화
 *
 * 현재 상태에 맞게 위젯을 등록/제거합니다.
 * - fleet-carrier-status: carrier 상태 표시 (aboveEditor)
 * - ua-panel: 멀티칼럼/상세 뷰 패널 (aboveEditor, 패널 펼침 시)
 *
 * lifecycle.ts에서 호출됩니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
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
import { renderCarrierStatus } from "../shipyard/carrier/status-renderer.js";
import { getState, makeFooterCols, WIDGET_KEY } from "./state.js";

const FLEET_CARRIER_STATUS_WIDGET_KEY = "fleet-carrier-status";

let pendingWidgetCtx: ExtensionContext | null = null;
let isWidgetSyncScheduled = false;

// ─── 위젯 동기화 ────────────────────────────────────────

/**
 * 현재 상태에 맞게 위젯을 등록/제거합니다.
 *
 * 렌더링 분기:
 * - expanded → aboveEditor 위젯으로 renderPanelFull 표시 (터미널 높이 기반 클램핑)
 * - !expanded → 패널 위젯 제거
 *
 * carrier 상태 위젯(aboveEditor)은 항상 등록됩니다.
 */
export function syncWidget(ctx: ExtensionContext): void {
  pendingWidgetCtx = ctx;
  if (isWidgetSyncScheduled) return;

  isWidgetSyncScheduled = true;
  queueMicrotask(() => {
    isWidgetSyncScheduled = false;
    const nextCtx = pendingWidgetCtx;
    pendingWidgetCtx = null;
    if (!nextCtx) return;
    applyWidgetSync(nextCtx);
  });
}

function applyWidgetSync(ctx: ExtensionContext): void {
  const s = getState();

  // carrier 상태 위젯 (aboveEditor) — 항상 등록
  ctx.ui.setWidget(FLEET_CARRIER_STATUS_WIDGET_KEY, (_tui, _theme) => ({
    render(width: number): string[] {
      const state = getState();
      const content = renderCarrierStatus({
        cols: makeFooterCols(),
        streaming: state.streaming,
        frame: state.frame,
      });
      if (!content) return [];
      const pad = Math.max(0, Math.floor((width - visibleWidth(content)) / 2));
      return [truncateToWidth(" ".repeat(pad) + content, width)];
    },
    invalidate() {},
  }), { placement: "aboveEditor" });

  // 멀티칼럼/상세 뷰 패널 (aboveEditor) — expanded 시만
  if (!s.expanded) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  ctx.ui.setWidget(WIDGET_KEY, (_tui, _theme) => ({
    render(width: number): string[] {
      const state = getState();
      const frameColor = state.detailCarrierId
        ? (resolveCarrierColor(state.detailCarrierId) || PANEL_COLOR)
        : PANEL_COLOR;

      // 터미널 높이 기반 bodyH 클램핑
      // 에디터(30%) + footer(2) + spacer/status 여유(5) 확보
      const termH = process.stdout.rows ?? 24;
      const reserved = Math.ceil(termH * 0.3) + 7;
      const maxBodyH = Math.max(MIN_BODY_H, termH - reserved);
      const effectiveBodyH = Math.min(state.bodyH, maxBodyH);

      return renderPanelFull(
        width, state.cols, state.frame, frameColor,
        state.bottomHint, state.detailCarrierId, effectiveBodyH,
        state.cursorColumn,
      );
    },
    invalidate() {},
  }));
}
