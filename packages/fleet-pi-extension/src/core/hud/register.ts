/**
 * core-hud — 상태바 에디터 확장
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드, 단축키 등록.
 * 에디터 UI 로직은 editor.ts에 분리.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";


import type { HudEditorState, StatusLinePreset } from "./types.js";
import { PRESETS } from "./presets.js";
import { invalidateGitStatus, invalidateGitBranch } from "./git-status.js";
import { mightChangeGitBranch } from "./utils.js";
import { setupCustomEditor, setupStatusBar } from "./editor.js";

// ═══════════════════════════════════════════════════════════════════════════
// 확장 진입점
// ═══════════════════════════════════════════════════════════════════════════

export default function hudEditor(pi: ExtensionAPI) {
  const state: HudEditorState = {
    enabled: true,
    sessionStartTime: Date.now(),
    currentCtx: null,
    getThinkingLevelFn: null,
    currentEditor: null,
    config: { preset: "sbluemin" },
    footerDataRef: null,
    tuiRef: null,
    layoutCache: { width: 0, result: null, timestamp: 0 },
  };

  // ── 이벤트 핸들러 ──

  pi.on("session_start", async (event, ctx) => {
    state.sessionStartTime = Date.now();
    state.currentCtx = ctx;
    state.getThinkingLevelFn = null;

    // 상태바는 항상 등록 (state.enabled와 무관, footerDataRef 획득 목적)
    setupStatusBar(ctx, state);

    if (state.enabled && ctx.hasUI) {
      setupCustomEditor(ctx, state);
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (mightChangeGitBranch(cmd)) {
        invalidateGitStatus();
        invalidateGitBranch();
        setTimeout(() => state.tuiRef?.requestRender(), 100);
      }
    }
  });

  pi.on("user_bash", async (event) => {
    if (mightChangeGitBranch(event.command)) {
      invalidateGitStatus();
      invalidateGitBranch();
      setTimeout(() => state.tuiRef?.requestRender(), 100);
      setTimeout(() => state.tuiRef?.requestRender(), 300);
      setTimeout(() => state.tuiRef?.requestRender(), 500);
    }
  });

  // ── 커맨드 등록 ──

  pi.registerCommand("fleet:hud:editor", {
    description: "Configure hud-editor status (toggle, preset)",
    handler: async (args, ctx) => {
      state.currentCtx = ctx;

      if (!args) {
        state.enabled = !state.enabled;
        if (state.enabled) {
          setupStatusBar(ctx, state);   // footer hook + footerDataRef/tuiRef 복구
          setupCustomEditor(ctx, state);
          ctx.ui.notify("hud-editor enabled", "info");
        } else {
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);   // 기본 footer 복원
          ctx.ui.setWidget("hud-status-bar", undefined);
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
