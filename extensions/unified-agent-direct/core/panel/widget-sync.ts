/**
 * panel/widget-sync.ts — PI TUI 위젯 브릿지
 *
 * 현재 상태에 맞게 aboveEditor 위젯을 등록/제거하고
 * footer 상태를 동기화합니다.
 *
 * lifecycle.ts에서 호출됩니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { UA_DIRECT_FOOTER_STATUS_KEY } from "../../../unified-agent-core/footer-status";
import {
  DIRECT_MODE_COLORS,
  PANEL_COLOR,
  MIN_BODY_H,
} from "../../constants";
import {
  renderPanelFull,
  renderPanelCompact,
} from "../render/panel-renderer";
import { renderFooterStatus } from "../render/footer-renderer.js";
import { getState, makeFooterCols, WIDGET_KEY } from "./state.js";

// ─── footer 동기화 ───────────────────────────────────────

/** footer 상태를 현재 패널 상태 기준으로 PI TUI에 반영합니다. */
export function syncFooterStatus(ctx: ExtensionContext | null): void {
  if (!ctx) return;
  const s = getState();
  const content = renderFooterStatus({
    cols: makeFooterCols(),
    streaming: s.streaming,
    frame: s.frame,
    modelConfig: s.modelConfig,
    // 서비스 상태 렌더러 — feature(status)에서 주입된 콜백 사용 (core→feature 역방향 의존 방지)
    renderServiceStatus: s.serviceStatusRenderer
      ? (cli) => s.serviceStatusRenderer!(cli, s.serviceSnapshots, s.serviceLoading)
      : undefined,
  });
  ctx.ui.setStatus(UA_DIRECT_FOOTER_STATUS_KEY, content);
}

// ─── 위젯 동기화 ────────────────────────────────────────

/**
 * 현재 상태에 맞게 aboveEditor 위젯을 등록/제거합니다.
 *
 * 렌더링 분기:
 * - expanded → aboveEditor 위젯으로 renderPanelFull 표시 (터미널 높이 기반 클램핑)
 * - !expanded + activeMode → 위젯 제거 (배너는 infra-hud/editor.ts에서 직접 렌더링)
 * - !expanded + streaming → 컴팩트 상태바 (renderPanelCompact)
 * - 그 외 → 위젯 제거
 */
export function syncWidget(ctx: ExtensionContext): void {
  const s = getState();
  syncFooterStatus(ctx);

  // 패널 접힘 + 활성 모드 → 배너는 에디터가 직접 렌더링하므로 위젯 불필요
  if (!s.expanded && s.activeMode) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  // 위젯 완전 제거 조건: 패널 접힘 + 모드 비활성 + 스트리밍 없음(또는 compact 숨김)
  if (!s.expanded && (!s.streaming || !s.showCompactWhenCollapsed)) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  ctx.ui.setWidget(WIDGET_KEY, (_tui, _theme) => ({
    render(width: number): string[] {
      const state = getState();

      if (state.expanded) {
        const frameColor = state.activeMode
          ? (DIRECT_MODE_COLORS[state.activeMode] ?? PANEL_COLOR)
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
        );
      }

      // 스트리밍 중 compact 상태바
      return renderPanelCompact(width, state.cols, state.frame);
    },
    invalidate() {},
  }));
}
