/**
 * panel/shortcuts.ts — 에이전트 패널 단축키 등록
 *
 * - alt+p: 패널 표시/숨김 토글
 * - alt+h: 인라인 슬롯 내비게이션 (왼쪽)
 * - alt+l: 인라인 슬롯 내비게이션 (오른쪽)
 * - ctrl+enter: 커서 위치의 Carrier 상세 뷰 토글
 * - alt+x: 선택/상세 Carrier 실행 취소
 * - alt+j: 패널 높이 증가
 * - alt+k: 패널 높이 감소
 *
 * 상세 뷰에서 alt+h/l → N칼럼 뷰로 복귀
 *
 * fleet/index.ts에서 호출됩니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../../../core/keybind/bridge.js";
import { BODY_H_STEP } from "../../constants.js";
import { abortCarrierRun } from "../../operation-runner.js";
import { toggleAgentPanel, showAgentPanel, setDetailView, getDetailCarrierId } from "./lifecycle.js";
import { adjustPanelHeight } from "./config.js";
import { getState, getFocusedCarrierId } from "./state.js";
import { syncWidget } from "./widget-sync.js";

export function registerAgentPanelShortcut(): void {
  const keybind = getKeybindAPI();

  // ── Alt+P: 패널 토글 (기존 동작 유지 + 커서 초기화) ──
  keybind.register({
    extension: "fleet",
    action: "panel-toggle",
    defaultKey: "alt+p",
    description: "Fleet Bridge 표시/숨김 토글",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const state = getState();
      // 패널 숨길 때 커서 초기화 + 상세 뷰 해제
      if (state.expanded) {
        state.cursorColumn = -1;
        if (state.detailCarrierId) {
          setDetailView(ctx, null);
        }
      }
      toggleAgentPanel(ctx);
    },
  });

  // ── Alt+H: 인라인 슬롯 내비게이션 (왼쪽) ──
  keybind.register({
    extension: "fleet",
    action: "slot-prev",
    defaultKey: "alt+h",
    description: "이전 Carrier 슬롯으로 이동",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      navigateSlot(ctx, -1);
    },
  });

  // ── Alt+L: 인라인 슬롯 내비게이션 (오른쪽) ──
  keybind.register({
    extension: "fleet",
    action: "slot-next",
    defaultKey: "alt+l",
    description: "다음 Carrier 슬롯으로 이동",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      navigateSlot(ctx, 1);
    },
  });

  // ── Ctrl+Enter: 커서 위치의 Carrier 상세 뷰 토글 ──
  keybind.register({
    extension: "fleet",
    action: "detail-toggle",
    defaultKey: "ctrl+enter",
    description: "선택된 Carrier 상세 뷰 토글",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const s = getState();
      if (!s.expanded) return;

      // 상세 뷰에서 ctrl+enter → N칼럼으로 복귀
      if (s.detailCarrierId) {
        const detailIdx = s.cols.findIndex((col) => col.cli === s.detailCarrierId);
        setDetailView(ctx, null);
        s.cursorColumn = Math.max(0, Math.min(detailIdx, s.cols.length - 1));
        syncWidget(ctx);
        return;
      }

      // N칼럼에서 ctrl+enter → 커서 위치의 carrier 상세 뷰
      if (s.cursorColumn < 0 || s.cursorColumn >= s.cols.length) return;
      const col = s.cols[s.cursorColumn];
      if (!col) return;

      setDetailView(ctx, col.cli);
      s.cursorColumn = -1;
      showAgentPanel(ctx);
    },
  });

  // ── Alt+X: 선택/상세 Carrier 실행 취소 ──
  keybind.register({
    extension: "fleet",
    action: "carrier-cancel",
    defaultKey: "alt+x",
    description: "선택된 Carrier 실행 취소",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const targetId = getFocusedCarrierId();
      if (!targetId) return;
      if (!abortCarrierRun(targetId)) {
        ctx.ui.notify("취소할 실행이 없습니다.", "warning");
        return;
      }
      ctx.ui.notify(`${targetId} 실행 취소 요청을 전송했습니다.`, "info");
    },
  });

  // ── Alt+J / Alt+K: 패널 높이 조절 ──
  keybind.register({
    extension: "fleet",
    action: "panel-grow",
    defaultKey: "alt+j",
    description: "Fleet Bridge 높이 증가",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      adjustPanelHeight(ctx, BODY_H_STEP);
    },
  });

  keybind.register({
    extension: "fleet",
    action: "panel-shrink",
    defaultKey: "alt+k",
    description: "Fleet Bridge 높이 감소",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      adjustPanelHeight(ctx, -BODY_H_STEP);
    },
  });
}

// ─── 슬롯 내비게이션 헬퍼 ────────────────────────────────

function navigateSlot(ctx: ExtensionContext, delta: number): void {
  const s = getState();

  // 상세 뷰 → N칼럼 복귀 (커서를 현재 상세 뷰 carrier 위치로 설정)
  const detailId = getDetailCarrierId();
  if (detailId) {
    const detailIdx = s.cols.findIndex((col) => col.cli === detailId);
    setDetailView(ctx, null);
    showAgentPanel(ctx);
    const fresh = getState();
    fresh.cursorColumn = Math.max(0, Math.min(detailIdx, fresh.cols.length - 1));
    syncWidget(ctx);
    return;
  }

  // N칼럼 모드 — 패널이 닫혀있으면 무시
  if (!s.expanded) return;
  if (s.cols.length === 0) return;

  if (s.cursorColumn < 0) {
    // 첫 입력: delta 방향에 따라 첫 번째 또는 마지막 칼럼
    s.cursorColumn = delta > 0 ? 0 : s.cols.length - 1;
  } else {
    // 순환 이동
    s.cursorColumn = (s.cursorColumn + delta + s.cols.length) % s.cols.length;
  }

  syncWidget(ctx);
}
