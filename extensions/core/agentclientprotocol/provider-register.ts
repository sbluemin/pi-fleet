/**
 * core/acp-provider — Extension 진입점 (wiring only)
 *
 * 역할: Gemini/Codex 모델군 등록, subagent 중복 방지, 세션 라이프사이클 핸들링.
 * 비즈니스 로직은 provider.ts / event-mapper.ts에 위임.
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  PROVIDER_ID,
  ACTIVE_STREAM_KEY,
  MODEL_CATALOG,
} from "./provider-types.js";
import { streamAcp, cleanupAll, handleSessionStart } from "./provider-stream.js";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 모델 카탈로그를 pi registerProvider 형식으로 변환 */
const MODELS = MODEL_CATALOG.map((m) => ({
  id: m.id,
  name: m.name,
  reasoning: m.reasoning,
  input: ["text", "image"] as string[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: m.contextWindow,
  maxTokens: m.maxTokens,
}));

// ═══════════════════════════════════════════════════════════════════════════
// Extension Entry Point
// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  // ── 세션 라이프사이클 ──

  pi.on("session_start", (event, ctx) => {
    if (event.reason === "new" || event.reason === "resume" || event.reason === "fork") {
      const piSessionId = ctx.sessionManager.getSessionId();
      handleSessionStart(event.reason, piSessionId).catch((err) => {
        console.error("[fleet-acp] session_start 처리 실패:", err);
      });
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    cleanupAll().catch((err) => {
      console.error("[fleet-acp] session_shutdown 정리 실패:", err);
    });

    // globalThis 스트림 참조 해제 — /reload 시 새 인스턴스가 등록 가능하도록
    const g = globalThis as Record<symbol, unknown>;
    if (g[ACTIVE_STREAM_KEY] === streamAcp) {
      g[ACTIVE_STREAM_KEY] = undefined;
    }
  });

  // ── Provider 등록 (subagent 중복 방지) ──

  const g = globalThis as Record<symbol, unknown>;

  if (!g[ACTIVE_STREAM_KEY]) {
    // 최초 인스턴스: streamSimple 참조 저장 후 등록
    g[ACTIVE_STREAM_KEY] = streamAcp;

    pi.registerProvider(PROVIDER_ID, {
      baseUrl: PROVIDER_ID,
      apiKey: "not-used",
      api: PROVIDER_ID,
      models: MODELS,
      streamSimple: streamAcp,
    });
  }
  // 후속 인스턴스(subagent): 부모의 ModelRegistry 등록을 공유하므로 skip
}
