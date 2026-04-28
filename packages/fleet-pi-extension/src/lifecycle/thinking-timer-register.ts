/**
 * Thinking Timer Extension
 *
 * 접힌 "Thinking..." 블록 옆에 실시간 경과 시간을 인라인 표시한다.
 * AssistantMessageComponent를 monkey-patch하여 구현.
 *
 * 원본: https://github.com/xRyul/pi-thinking-timer (MIT, xryul)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	type Store,
	getStore,
	setStore,
	keyFor,
	ensureAssistantMessagePatchInstalled,
	startTicker,
	stopTicker,
	triggerTick,
	finalizeThinkingBlock,
} from "../tui/thinking-timer.js";

export default function thinkingTimer(pi: ExtensionAPI) {
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
			return;
		}
	});

	pi.on("message_end", async (event, _ctx) => {
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
