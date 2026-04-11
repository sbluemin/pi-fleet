/**
 * core-settings — 중앙 설정 API + 오버레이 팝업 확장
 *
 * 배선(wiring)만 담당:
 *   - globalThis API 등록
 *   - Alt+/ 단축키로 설정 오버레이 팝업 열기
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../keybind/bridge.js";
import { CORE_SETTINGS_KEY } from "./bridge.js";
import type { CoreSettingsAPI } from "./types.js";
import { loadSection, saveSection } from "./store.js";
import { registerSection, unregisterSection, getSections } from "./registry.js";
import { SettingsOverlay } from "./overlay.js";

// ── globalThis API 객체 생성 ──

const api: CoreSettingsAPI = {
  load: loadSection,
  save: saveSection,
  registerSection,
  unregisterSection,
};

// ── 팝업 상태 ──

let activePopup: Promise<void> | null = null;

// 즉시 등록 — 다른 확장의 모듈 초기화 시점에도 접근 가능하도록
(globalThis as any)[CORE_SETTINGS_KEY] = api;

export default function (_pi: ExtensionAPI) {
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

  const sections = getSections();

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
