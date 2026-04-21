/**
 * Thinking Timer — 핵심 로직
 *
 * 접힌 "Thinking..." 블록 옆에 실시간 경과 시간을 표시한다.
 *   Thinking... 6.5s
 *
 * AssistantMessageComponent.updateContent()를 monkey-patch하여
 * 하드코딩된 "Thinking..." 레이블을 시간 정보가 포함된 레이블로 교체한다.
 *
 * 원본: https://github.com/xRyul/pi-thinking-timer (MIT, xryul)
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { AssistantMessageComponent } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type Store = {
	/** 활성 thinking 블록: key → 시작 시간 (ms) */
	starts: Map<string, number>;
	/** 완료된 thinking 블록: key → 소요 시간 (ms) */
	durations: Map<string, number>;
	/** 접힌 thinking 블록의 렌더링된 레이블 컴포넌트 */
	labels: Map<string, Text>;
	/** 최신 테마 참조 */
	theme?: ExtensionContext["ui"]["theme"];
};

// ─── 심볼 키 ──────────────────────────────────────────────────────────────────

const STORE_KEY = Symbol.for("pi.extensions.thinkingTimer.store");
const PATCH_KEY = Symbol.for("pi.extensions.thinkingTimer.patch");

// ─── Ticker ───────────────────────────────────────────────────────────────────

let ticker: ReturnType<typeof setInterval> | null = null;

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

export function getStore(): Store | undefined {
	return (globalThis as any)[STORE_KEY] as Store | undefined;
}

export function setStore(store: Store): void {
	(globalThis as any)[STORE_KEY] = store;
}

export function keyFor(timestamp: number, contentIndex: number): string {
	return `${timestamp}:${contentIndex}`;
}

export function ensureAssistantMessagePatchInstalled(): void {
	const proto: any = AssistantMessageComponent.prototype as any;
	if (proto[PATCH_KEY]) return;
	proto[PATCH_KEY] = true;

	const originalUpdateContent = proto.updateContent;

	proto.updateContent = function patchedUpdateContent(this: any, message: any) {
		originalUpdateContent.call(this, message);

		try {
			const store = getStore();
			if (!store) return;
			if (!message || !message.content || !Array.isArray(message.content)) return;
			if (!this.hideThinkingBlock) return;
			if (!this.contentContainer || !Array.isArray(this.contentContainer.children)) return;

			// 접힌 레이블을 생성할 thinking content 인덱스 탐색
			const thinkingIndices: number[] = [];
			for (let i = 0; i < message.content.length; i++) {
				const c = message.content[i];
				if (c?.type === "thinking" && typeof c.thinking === "string" && c.thinking.trim()) {
					thinkingIndices.push(i);
				}
			}
			if (thinkingIndices.length === 0) return;

			// 현재 "Thinking..." 하드코딩 레이블을 가진 Text 컴포넌트 탐색
			const labelComponents: Text[] = [];
			for (const child of this.contentContainer.children as any[]) {
				if (!child || typeof child !== "object") continue;
				if (typeof child.setText !== "function") continue;
				if (typeof child.text !== "string") continue;
				if (!child.text.includes("Thinking...")) continue;
				labelComponents.push(child as Text);
			}
			if (labelComponents.length === 0) return;

			const count = Math.min(thinkingIndices.length, labelComponents.length);
			for (let j = 0; j < count; j++) {
				const contentIndex = thinkingIndices[j]!;
				const label = labelComponents[j]!;
				const k = keyFor(message.timestamp, contentIndex);
				store.labels.set(k, label);

				let ms: number | null = null;
				const start = store.starts.get(k);
				const dur = store.durations.get(k);
				if (dur !== undefined) {
					ms = dur;
				} else if (start !== undefined) {
					ms = Date.now() - start;
				}

				if (ms !== null) {
					label.setText(makeThinkingLabel(store.theme, ms));
				}
			}
		} catch {
			// 렌더링을 절대 깨뜨리지 않는다
		}
	};
}

export function stopTicker(): void {
	if (ticker) {
		clearInterval(ticker);
		ticker = null;
	}
}

export function startTicker(): void {
	if (ticker) return;
	ticker = setInterval(tick, 100);
}

export function triggerTick(): void {
	tick();
}

// ─── Thinking 블록 종료 처리 ──────────────────────────────────────────────────

export function finalizeThinkingBlock(k: string, endTimeMs = Date.now()): void {
	const s = getStore();
	if (!s) return;
	const start = s.starts.get(k);
	if (start === undefined) return;
	const dur = Math.max(0, endTimeMs - start);
	s.starts.delete(k);
	s.durations.set(k, dur);

	const label = s.labels.get(k);
	if (label) {
		label.setText(makeThinkingLabel(s.theme, dur));
	}
}

function formatElapsed(ms: number): string {
	const totalSeconds = ms / 1000;
	if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds - minutes * 60;
	return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function makeThinkingLabel(theme: Store["theme"] | undefined, ms: number | null): string {
	if (!theme) {
		return ms === null ? "Thinking..." : `Thinking... ${formatElapsed(ms)}`;
	}
	if (ms === null) {
		return theme.italic(theme.fg("thinkingText", "Thinking..."));
	}
	const base = theme.fg("thinkingText", "Thinking...");
	const time = theme.fg("dim", ` ${formatElapsed(ms)}`);
	return theme.italic(base + time);
}

// ─── Monkey-patch ─────────────────────────────────────────────────────────────

function tick(): void {
	const s = getStore();
	if (!s) return;
	if (s.starts.size === 0) {
		stopTicker();
		return;
	}
	for (const [k, start] of s.starts.entries()) {
		const label = s.labels.get(k);
		if (!label) continue;
		label.setText(makeThinkingLabel(s.theme, Date.now() - start));
	}
}
