/**
 * infra-keybind — 중앙 집중 키바인딩 확장
 *
 * 배선(wiring)만 담당:
 *   - factory에서 실제 API 구현 주입 (큐 flush)
 *   - Alt+? 단축키로 키바인딩 오버레이 팝업 열기
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { INFRA_KEYBIND_KEY, _bootstrapKeybind } from "./types.js";
import type { InfraKeybindAPI, KeybindRegistration, ResolvedBinding } from "./types.js";
import { getOverrideKey } from "./store.js";
import { addBinding, getBindings, getKey } from "./registry.js";
import { KeybindOverlay } from "./overlay.js";

// ── 팝업 상태 ──

let activePopup: Promise<void> | null = null;

export default function (pi: ExtensionAPI) {
  // 실제 API 구현 생성
  const realApi: InfraKeybindAPI = {
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

  // ── session_start 시 단축키 재등록 ──
  // v0.65.0에서 세션 전환 시 새 ExtensionRunner가 생성되어 shortcuts Map이 초기화됨.
  // globalThis의 _impl이 이전 세션의 extension API를 참조하므로,
  // 기존 바인딩을 현재 세션의 pi.registerShortcut()으로 재등록해야 함.
  pi.on("session_start", (event) => {
    if (event.reason === "startup") return; // 최초 부팅 시에는 factory에서 이미 등록됨
    const bindings = getBindings();
    for (const binding of bindings) {
      pi.registerShortcut(binding.resolvedKey as any, {
        description: binding.description,
        handler: binding.handler,
      });
    }
  });

  // 자체 오버레이 단축키 등록 (storedPi가 설정된 후이므로 즉시 등록됨)
  const keybindApi = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybindApi.register({
    extension: "infra-keybind",
    action: "popup",
    defaultKey: "alt+.",
    description: "키바인딩 오버레이 팝업 표시",
    category: "Infra",
    handler: async (ctx) => {
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
