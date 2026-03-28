/**
 * infra-hud — 상태바 에디터 확장
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드, 단축키 등록.
 * 에디터 UI 로직은 editor.ts에 분리.
 */

import type { ExtensionAPI, ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";


import { INFRA_KEYBIND_KEY } from "../infra-keybind/types.js";
import type { InfraKeybindAPI } from "../infra-keybind/types.js";
import type { HudCoreConfig, StatusLinePreset } from "./types.js";
import { PRESETS } from "./presets.js";
import { invalidateGitStatus, invalidateGitBranch } from "./git-status.js";
import { mightChangeGitBranch } from "./utils.js";
import { setupCustomEditor, setupFooter } from "./editor.js";

// ═══════════════════════════════════════════════════════════════════════════
// 에디터 상태 타입 (이 확장 내부에서만 사용)
// ═══════════════════════════════════════════════════════════════════════════

export interface HudEditorState {
  enabled: boolean;
  sessionStartTime: number;
  currentCtx: any;
  getThinkingLevelFn: (() => string) | null;
  isStreaming: boolean;
  stashedEditorText: string | null;
  currentEditor: any;
  config: HudCoreConfig;
  /** footer 콜백에서 직접 수신한 데이터 제공자 (hud-footer globalThis 불필요) */
  footerDataRef: ReadonlyFooterDataProvider | null;
  /** footer 콜백에서 직접 수신한 TUI 인스턴스 */
  tuiRef: any;
  layoutCache: {
    width: number;
    result: { topContent: string; secondaryContent: string } | null;
    timestamp: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 확장 진입점
// ═══════════════════════════════════════════════════════════════════════════

export default function hudEditor(pi: ExtensionAPI) {
  const state: HudEditorState = {
    enabled: true,
    sessionStartTime: Date.now(),
    currentCtx: null,
    getThinkingLevelFn: null,
    isStreaming: false,
    stashedEditorText: null,
    currentEditor: null,
    config: { preset: "sbluemin" },
    footerDataRef: null,
    tuiRef: null,
    layoutCache: { width: 0, result: null, timestamp: 0 },
  };

  // ── 이벤트 핸들러 ──

  pi.on("session_start", async (_event, ctx) => {
    state.sessionStartTime = Date.now();
    state.currentCtx = ctx;
    state.isStreaming = false;

    if (typeof ctx.getThinkingLevel === "function") {
      state.getThinkingLevelFn = () => ctx.getThinkingLevel();
    }

    // Footer는 항상 등록 (state.enabled와 무관)
    setupFooter(ctx, state);

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

  pi.on("agent_start", async () => {
    state.isStreaming = true;
  });

  pi.on("agent_end", async (_event, ctx) => {
    state.isStreaming = false;
    if (ctx.hasUI) {
      // stash 자동 복원
      if (state.stashedEditorText !== null) {
        if (ctx.ui.getEditorText().trim() === "") {
          ctx.ui.setEditorText(state.stashedEditorText);
          state.stashedEditorText = null;
          ctx.ui.setStatus("stash", undefined);
          ctx.ui.notify("Stash restored", "info");
        } else {
          ctx.ui.notify("Stash preserved — Alt+S to swap", "info");
        }
      }
    }
  });

  pi.on("session_switch", async (_event, ctx) => {
    state.sessionStartTime = Date.now();
    state.currentCtx = ctx;
    state.isStreaming = false;
    if (state.stashedEditorText !== null) {
      state.stashedEditorText = null;
      if (ctx.hasUI) {
        ctx.ui.setStatus("stash", undefined);
      }
    }
    setupFooter(ctx, state);
  });

  // ── 커맨드 등록 ──

  pi.registerCommand("fleet:hud:editor", {
    description: "Configure hud-editor status (toggle, preset)",
    handler: async (args, ctx) => {
      state.currentCtx = ctx;

      if (!args) {
        state.enabled = !state.enabled;
        if (state.enabled) {
          setupCustomEditor(ctx, state);
          ctx.ui.notify("hud-editor enabled", "info");
        } else {
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setHeader(undefined);
          ctx.ui.setWidget("hud-editor-secondary", undefined);
          ctx.ui.setWidget("hud-editor-status", undefined);
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

  // ── 단축키 등록 ──

  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "infra-hud",
    action: "stash",
    defaultKey: "alt+s",
    description: "Stash/restore editor text",
    category: "Infra",
    handler: async (ctx) => {
      const rawText = state.currentEditor?.getExpandedText?.() ?? ctx.ui.getEditorText();
      const hasText = rawText.trim().length > 0;
      const hasStash = state.stashedEditorText !== null;

      if (hasText && !hasStash) {
        state.stashedEditorText = rawText;
        ctx.ui.setEditorText("");
        ctx.ui.setStatus("stash", "📋 stash");
        ctx.ui.notify("Text stashed", "info");
        return;
      }

      if (!hasText && hasStash) {
        ctx.ui.setEditorText(state.stashedEditorText);
        state.stashedEditorText = null;
        ctx.ui.setStatus("stash", undefined);
        ctx.ui.notify("Stash restored", "info");
        return;
      }

      if (hasText && hasStash) {
        const prev = state.stashedEditorText;
        state.stashedEditorText = rawText;
        ctx.ui.setEditorText(prev);
        ctx.ui.setStatus("stash", "📋 stash");
        ctx.ui.notify("Stash swapped", "info");
        return;
      }

      ctx.ui.notify("Nothing to stash", "info");
    },
  });
}

