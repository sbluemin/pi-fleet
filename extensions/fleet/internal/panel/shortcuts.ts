/**
 * panel/shortcuts.ts — 에이전트 패널 단축키 등록
 *
 * - alt+p: 패널 표시/숨김 토글
 * - alt+h: 인라인 슬롯 내비게이션 (왼쪽)
 * - alt+l: 인라인 슬롯 내비게이션 (오른쪽)
 * - ctrl+enter: 커서 위치의 Carrier 독점 모드 활성화
 * - alt+j: 패널 높이 증가
 * - alt+k: 패널 높이 감소
 *
 * 독점 모드에서 alt+h/l → carrier 비활성화 + N칼럼 복귀 (alt+slot 대체 탈출 경로)
 *
 * fleet/index.ts에서 호출됩니다.
 */

import { INFRA_KEYBIND_KEY } from "../../../dock/keybind/types.js";
import type { InfraKeybindAPI } from "../../../dock/keybind/types.js";
import { BODY_H_STEP } from "../../constants";
import { toggleAgentPanel, showAgentPanel } from "./lifecycle.js";
import { adjustPanelHeight } from "./config.js";
import { getState } from "./state.js";
import { syncWidget } from "./widget-sync.js";

import {
  activateCarrier,
  deactivateCarrier,
  getActiveCarrierId,
} from "../../shipyard/carrier/framework.js";

export function registerAgentPanelShortcut(): void {
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;

  // ── Alt+P: 패널 토글 (기존 동작 유지 + 커서 초기화) ──
  keybind.register({
    extension: "fleet",
    action: "panel-toggle",
    defaultKey: "alt+p",
    description: "Fleet Bridge 표시/숨김 토글",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const s = getState();
      // 패널 숨길 때 커서 초기화
      if (s.expanded) {
        s.cursorColumn = -1;
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

  // ── Ctrl+Enter: 커서 위치의 Carrier 독점 모드 활성화 ──
  keybind.register({
    extension: "fleet",
    action: "slot-activate",
    defaultKey: "ctrl+enter",
    description: "선택된 Carrier 독점 모드 활성화",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const s = getState();
      if (!s.expanded || s.cursorColumn < 0) return;
      if (s.cursorColumn >= s.cols.length) return;

      const col = s.cols[s.cursorColumn];
      if (!col) return;

      // 독점 모드 활성화 + 커서 초기화
      activateCarrier(ctx, col.cli);
      s.cursorColumn = -1;
      showAgentPanel(ctx);
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

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

function navigateSlot(ctx: ExtensionContext, delta: number): void {
  const s = getState();

  // 패널이 닫혀있으면 무시
  if (!s.expanded) return;

  // 독점 모드 → carrier 비활성화 + N칼럼 복귀 + 커서 위치 설정
  const activeId = getActiveCarrierId();
  if (activeId) {
    // 현재 활성 carrier의 칼럼 인덱스를 찾아 커서 시작 위치로 설정
    const activeIdx = s.cols.findIndex((col) => col.cli === activeId);
    deactivateCarrier(ctx, activeId);
    // deactivateCarrier가 패널을 숨기므로 다시 펼침
    showAgentPanel(ctx);
    // 비활성화 후 cols가 재초기화되므로 다시 읽기
    const fresh = getState();
    fresh.cursorColumn = Math.max(0, Math.min(activeIdx, fresh.cols.length - 1));
    syncWidget(ctx);
    return;
  }

  // N칼럼 모드 — 커서 이동
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
