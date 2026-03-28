/**
 * panel/shortcuts.ts — 에이전트 패널 단축키 등록
 *
 * - alt+p: 패널 표시/숨김 토글
 * - alt+j: 패널 높이 증가
 * - alt+k: 패널 높이 감소
 *
 * unified-agent-direct/index.ts에서 호출됩니다.
 */

import { INFRA_KEYBIND_KEY } from "../../../../extensions-infra/keybind/types.js";
import type { InfraKeybindAPI } from "../../../../extensions-infra/keybind/types.js";
import { BODY_H_STEP } from "../../constants";
import { toggleAgentPanel } from "./lifecycle.js";
import { adjustPanelHeight } from "./config.js";

export function registerAgentPanelShortcut(): void {
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;

  keybind.register({
    extension: "unified-agent-direct",
    action: "panel-toggle",
    defaultKey: "alt+p",
    description: "에이전트 패널 표시/숨김 토글",
    category: "Agent Panel",
    handler: async (ctx) => {
      toggleAgentPanel(ctx);
    },
  });

  keybind.register({
    extension: "unified-agent-direct",
    action: "panel-grow",
    defaultKey: "alt+j",
    description: "에이전트 패널 높이 증가",
    category: "Agent Panel",
    handler: async (ctx) => {
      adjustPanelHeight(ctx, BODY_H_STEP);
    },
  });

  keybind.register({
    extension: "unified-agent-direct",
    action: "panel-shrink",
    defaultKey: "alt+k",
    description: "에이전트 패널 높이 감소",
    category: "Agent Panel",
    handler: async (ctx) => {
      adjustPanelHeight(ctx, -BODY_H_STEP);
    },
  });
}
