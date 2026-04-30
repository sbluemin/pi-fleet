/**
 * core-hud — 상태바 에디터 확장
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드, 단축키 등록.
 * 에디터 UI 로직은 editor.ts에 분리.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { setupCustomEditor, setupHudRenderRequestBridge, setupStatusBar } from "./hud/editor.js";
import { invalidateGitBranch, invalidateGitStatus } from "./hud/git-status.js";
import type { HudEditorState } from "./hud/types.js";

export default function registerHudLifecycle(pi: ExtensionAPI) {
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
  setupHudRenderRequestBridge(state);

  pi.on("session_start", async (_event, ctx) => {
    state.sessionStartTime = Date.now();
    state.currentCtx = ctx;
    state.getThinkingLevelFn = null;

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
}

function mightChangeGitBranch(cmd: string): boolean {
  const gitBranchPatterns = [
    /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
    /\bgit\s+stash\s+(pop|apply)/,
  ];
  return gitBranchPatterns.some((pattern) => pattern.test(cmd));
}
