/**
 * core-hud — 상태바 에디터 확장
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드, 단축키 등록.
 * 에디터 UI 로직은 editor.ts에 분리.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { setupCustomEditor, setupStatusBar } from "./editor.js";
import { PRESETS } from "./presets.js";
import type { HudEditorState, StatusLinePreset } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════
// 확장 진입점
// ═══════════════════════════════════════════════════════════════════════════

export default function registerHudCommand(pi: ExtensionAPI, state: HudEditorState) {
  pi.registerCommand("fleet:hud:editor", {
    description: "Configure hud-editor status (toggle, preset)",
    handler: async (args, ctx) => {
      state.currentCtx = ctx;
      state.selectedModel = ctx.model;

      if (!args) {
        state.enabled = !state.enabled;
        if (state.enabled) {
          setupStatusBar(ctx, state);   // footer hook + footerDataRef/tuiRef 복구
          setupCustomEditor(ctx, state);
          ctx.ui.notify("hud-editor enabled", "info");
        } else {
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);   // 기본 footer 복원
          ctx.ui.setWidget("hud-notification", undefined);
          state.footerDataRef = null;
          state.tuiRef = null;
          state.currentEditor = null;
          state.layoutCache.result = null;
          ctx.ui.notify("Defaults restored", "info");
        }
        return;
      }

      const preset = args.trim().toLowerCase() as StatusLinePreset;
      if (preset in PRESETS) {
        state.config.preset = preset;
        state.layoutCache.result = null;
        if (state.enabled) {
          setupCustomEditor(ctx, state);
        }
        ctx.ui.notify(`Preset set to: ${preset}`, "info");
        return;
      }

      const presetList = Object.keys(PRESETS).join(", ");
      ctx.ui.notify(`Available presets: ${presetList}`, "info");
    },
  });

}
