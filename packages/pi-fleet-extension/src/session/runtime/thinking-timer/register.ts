import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
  type Store,
  ensureAssistantMessagePatchInstalled,
  finalizeThinkingBlock,
  keyFor,
  setStore,
  startTicker,
  stopTicker,
  triggerTick,
} from "../../../tui/thinking-timer.js";

export default function registerThinkingTimerLifecycle(pi: ExtensionAPI): void {
  const store: Store = {
    starts: new Map(),
    durations: new Map(),
    labels: new Map(),
    theme: undefined,
  };
  setStore(store);
  ensureAssistantMessagePatchInstalled();

  function resetAll(ctx: ExtensionContext) {
    stopTicker();
    store.starts.clear();
    store.durations.clear();
    store.labels.clear();
    store.theme = ctx.ui.theme;
    ctx.ui.setWorkingMessage();
  }

  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "resume" || event.reason === "new") {
      resetAll(ctx);
      return;
    }
    store.theme = ctx.ui.theme;
    ctx.ui.setWorkingMessage();
  });

  pi.on("message_update", async (event, ctx) => {
    store.theme = ctx.ui.theme;

    const se = event.assistantMessageEvent as any;
    if (!se || typeof se.type !== "string") return;

    if (se.type === "thinking_start" || se.type === "thinking_delta") {
      const msg = se.partial;
      const k = keyFor(msg.timestamp, se.contentIndex);
      if (!store.starts.has(k)) {
        store.starts.set(k, Date.now());
      }
      startTicker();
      triggerTick();
      return;
    }

    if (se.type === "thinking_end") {
      const msg = se.partial;
      const k = keyFor(msg.timestamp, se.contentIndex);
      finalizeThinkingBlock(k);
      if (store.starts.size === 0) stopTicker();
    }
  });

  pi.on("message_end", async (event) => {
    const msg: any = event.message;
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return;

    for (let i = 0; i < msg.content.length; i++) {
      const c = msg.content[i];
      if (c?.type !== "thinking") continue;
      const k = keyFor(msg.timestamp, i);
      if (store.starts.has(k)) {
        finalizeThinkingBlock(k, Date.now());
      }
    }
    if (store.starts.size === 0) stopTicker();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    resetAll(ctx);
  });
}
