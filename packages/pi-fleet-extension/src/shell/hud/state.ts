import type { HudEditorState } from "./types.js";

export function createHudEditorState(): HudEditorState {
  return {
    enabled: true,
    sessionStartTime: Date.now(),
    currentCtx: null,
    selectedModel: undefined,
    getThinkingLevelFn: null,
    currentEditor: null,
    config: { preset: "sbluemin" },
    footerDataRef: null,
    tuiRef: null,
    themeRef: null,
    layoutCache: { width: 0, result: null, timestamp: 0 },
  };
}
