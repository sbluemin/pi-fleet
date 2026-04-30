/**
 * core-settings — 중앙 설정 API + 오버레이 팝업 확장
 *
 * 배선(wiring)만 담당:
 *   - Alt+/ 단축키로 설정 오버레이 팝업 열기
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getSettingsService } from "@sbluemin/fleet-core/services/settings";

import { SettingsOverlay } from "../tui/overlays/settings-overlay.js";
import { getKeybindAPI } from "./core/bridge.js";

// ── 팝업 상태 ──

let activePopup: Promise<void> | null = null;

export default function (_pi?: ExtensionAPI) {
  const keybind = getKeybindAPI();
  keybind.register({
    extension: "core-settings",
    action: "popup",
    defaultKey: "alt+/",
    description: "설정 오버레이 팝업 표시",
    category: "Core",
    handler: async (ctx) => {
      await openSettingsPopup(ctx);
    },
  });
}

/** 설정 오버레이 팝업 열기 */
async function openSettingsPopup(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  if (activePopup) return;

  const sections = getSettingsService()?.getSections() ?? [];

  activePopup = ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) =>
      new SettingsOverlay(theme, sections, done),
    {
      overlay: true,
      overlayOptions: {
        width: "50%",
        maxHeight: "50%",
        anchor: "center",
        margin: 1,
      },
    },
  );

  try {
    await activePopup;
  } finally {
    activePopup = null;
  }
}

// ── 확장 진입점 ──
