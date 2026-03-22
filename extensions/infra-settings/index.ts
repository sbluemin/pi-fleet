/**
 * infra-settings — 중앙 설정 API + 오버레이 팝업 확장
 *
 * 배선(wiring)만 담당:
 *   - globalThis API 등록
 *   - Alt+/ 단축키로 설정 오버레이 팝업 열기
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { INFRA_KEYBIND_KEY } from "../infra-keybind/types.js";
import type { InfraKeybindAPI } from "../infra-keybind/types.js";
import { INFRA_SETTINGS_KEY } from "./types.js";
import type { InfraSettingsAPI } from "./types.js";
import { loadSection, saveSection } from "./store.js";
import { registerSection, unregisterSection, getSections } from "./registry.js";
import { SettingsOverlay } from "./overlay.js";

// ── globalThis API 객체 생성 ──

const api: InfraSettingsAPI = {
  load: loadSection,
  save: saveSection,
  registerSection,
  unregisterSection,
};

// 즉시 등록 — 다른 확장의 모듈 초기화 시점에도 접근 가능하도록
(globalThis as any)[INFRA_SETTINGS_KEY] = api;

// ── 팝업 상태 ──

let activePopup: Promise<void> | null = null;

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

export default function (_pi: ExtensionAPI) {
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "infra-settings",
    action: "popup",
    defaultKey: "alt+/",
    description: "설정 오버레이 팝업 표시",
    category: "Infra",
    handler: async (ctx) => {
      await openSettingsPopup(ctx);
    },
  });
}
