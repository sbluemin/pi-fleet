/**
 * core-keybind — 중앙 집중 키바인딩 확장
 *
 * 배선(wiring)만 담당:
 *   - factory에서 실제 API 구현 주입 (큐 flush)
 *   - Alt+? 단축키로 키바인딩 오버레이 팝업 열기
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { _bootstrapKeybind, getKeybindAPI } from "./core/bridge.js";
import type { CoreKeybindAPI, KeybindRegistration, ResolvedBinding } from "./core/types.js";
import { getOverrideKey } from "./core/store.js";
import { addBinding, getBindings, getKey } from "./core/registry.js";
import { KeybindOverlay } from "../tui/overlays/keybind-overlay.js";

// ── 팝업 상태 ──

let activePopup: Promise<void> | null = null;

export default function (pi: ExtensionAPI) {
  // 실제 API 구현 생성
  const realApi: CoreKeybindAPI = {
    register(binding: KeybindRegistration): void {
      const override = getOverrideKey(binding.extension, binding.action);
      const resolvedKey = override ?? binding.defaultKey;
      const resolved: ResolvedBinding = { ...binding, resolvedKey };

      addBinding(resolved);

      pi.registerShortcut(resolvedKey as any, {
        description: binding.description,
        handler: binding.handler,
      });
    },
    getBindings,
    getKey,
  };

  // stub API에 실제 구현 주입 + 큐 flush
  _bootstrapKeybind(realApi);

  // 자체 오버레이 단축키 등록 (storedPi가 설정된 후이므로 즉시 등록됨)
  const keybindApi = getKeybindAPI();
  keybindApi.register({
    extension: "core-keybind",
    action: "popup",
    defaultKey: "alt+.",
    description: "키바인딩 오버레이 팝업 표시",
    category: "Core",
    handler: async (ctx) => {
      await openKeybindPopup(ctx);
    },
  });
}

export function reregisterCoreKeybinds(pi: ExtensionAPI): void {
  for (const binding of getBindings()) {
    pi.registerShortcut(binding.resolvedKey as any, {
      description: binding.description,
      handler: binding.handler,
    });
  }
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
