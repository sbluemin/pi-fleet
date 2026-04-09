/**
 * core/claude-provider — Extension 진입점 (wiring only)
 *
 * 역할: provider 등록, subagent 중복 방지, 세션 라이프사이클 핸들링.
 * 비즈니스 로직은 provider.ts / mcp-bridge.ts / message-mapper.ts에 위임.
 */

import { getModels } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { PROVIDER_ID, ACTIVE_STREAM_KEY, LATEST_MODEL_IDS, getOrInitState } from "./types.js";
import { streamClaudeAgentSdk } from "./provider.js";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** anthropic 모델 중 최신 ID만 필터링하여 provider 모델 목록 구성 */
const MODELS = getModels("anthropic")
  .filter((model) => LATEST_MODEL_IDS.has(model.id))
  .map((model) => ({
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }));

// ═══════════════════════════════════════════════════════════════════════════
// Extension Entry Point
// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  // ── 세션 라이프사이클 ──

  const clearSession = () => {
    const state = getOrInitState();
    state.activeQuery = null;
    state.currentPiStream = null;
    state.sharedSession = null;
    state.pendingToolCalls = [];
    state.pendingResults = [];
    state.queryStateStack = [];

    // globalThis 스트림 참조 해제 — /reload 시 새 인스턴스가 등록 가능하도록
    const g = globalThis as Record<symbol, unknown>;
    if (g[ACTIVE_STREAM_KEY] === streamClaudeAgentSdk) {
      g[ACTIVE_STREAM_KEY] = undefined;
    }
  };

  pi.on("session_start", (event) => {
    if (event.reason === "new" || event.reason === "resume" || event.reason === "fork") {
      clearSession();
    }
  });

  pi.on("session_shutdown", () => clearSession());

  // ── Provider 등록 (subagent 중복 방지) ──

  const g = globalThis as Record<symbol, unknown>;

  if (!g[ACTIVE_STREAM_KEY]) {
    // 최초 인스턴스: streamSimple 참조 저장 후 등록
    g[ACTIVE_STREAM_KEY] = streamClaudeAgentSdk;

    pi.registerProvider(PROVIDER_ID, {
      baseUrl: PROVIDER_ID,
      apiKey: "not-used",
      api: PROVIDER_ID,
      models: MODELS,
      streamSimple: streamClaudeAgentSdk,
    });
  }
  // 후속 인스턴스(subagent): 부모의 ModelRegistry 등록을 공유하므로 skip
}
