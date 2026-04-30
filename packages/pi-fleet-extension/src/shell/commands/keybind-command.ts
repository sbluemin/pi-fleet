/**
 * core-keybind — 중앙 집중 키바인딩 확장
 *
 * 배선(wiring)만 담당:
 *   - factory에서 실제 API 구현 주입 (큐 flush)
 *   - Alt+? 단축키로 키바인딩 오버레이 팝업 열기
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getBindings } from "../keybinds/core/registry.js";
import { KeybindOverlay } from "../overlays/keybind-overlay.js";

// ── 팝업 상태 ──

let activePopup: Promise<void> | null = null;

export default function registerKeybindPopupCommand(pi: ExtensionAPI) {
  pi.registerCommand("fleet:keybind:popup", {
    description: "키바인딩 오버레이 팝업 표시",
    handler: async (_args, ctx) => {
      await openKeybindPopup(ctx);
    },
  });
}

/** 키바인딩 오버레이 팝업 열기 */
async function openKeybindPopup(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  if (activePopup) return;

  const bindings = getBindings();

  activePopup = ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) =>
      new KeybindOverlay(theme, bindings, done),
    {
      overlay: true,
      overlayOptions: {
        width: "50%",
        maxHeight: "70%",
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
