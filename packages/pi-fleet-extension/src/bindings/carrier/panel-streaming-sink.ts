import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  AgentStreamEvent,
  AgentStreamKey,
  AgentStreamingSink,
} from "@sbluemin/fleet-core";
import type { ColStatus } from "@sbluemin/fleet-core/agent/types";
import {
  appendTextBlockByRunId,
  appendThoughtBlockByRunId,
  createRun,
  finalizeRunByRunId,
  getRunById,
  updateRunStatusByRunId,
  upsertToolBlockByRunId,
} from "@sbluemin/fleet-core/admiral/bridge/run-stream";

import {
  beginColStreaming,
  endColStreaming,
  updateAgentCol,
} from "../../tui/panel-lifecycle.js";
import { findColIndex } from "../../tui/panel/state.js";

export type PanelStreamingContextResolver = () => ExtensionContext | undefined;

interface PanelStreamState {
  readonly ctx?: ExtensionContext;
  readonly colIndex: number;
  readonly runId: string;
}

const activeStreams = new Map<string, PanelStreamState>();

export function createPanelStreamingSink(
  ctxOrResolver?: ExtensionContext | PanelStreamingContextResolver,
): AgentStreamingSink {
  const resolveCtx = createContextResolver(ctxOrResolver);

  return {
    onAgentStreamEvent(event) {
      handleAgentStreamEvent(event, resolveCtx);
    },
  };
}

export function handleAgentStreamEvent(
  event: AgentStreamEvent,
  resolveCtx: PanelStreamingContextResolver,
): void {
  if (event.type === "request_begin") {
    beginPanelStream(event.key, event.requestPreview, resolveCtx);
    return;
  }

  if (event.type === "status") {
    const runId = getActiveRunId(event.key);
    if (runId) updateRunStatusByRunId(runId, event.status);
    syncPanelColumn(event.key);
    return;
  }

  if (event.type === "message") {
    const runId = getActiveRunId(event.key);
    if (runId) appendTextBlockByRunId(runId, sanitizeChunk(event.text));
    syncPanelColumn(event.key);
    return;
  }

  if (event.type === "thought") {
    const runId = getActiveRunId(event.key);
    if (runId) appendThoughtBlockByRunId(runId, sanitizeChunk(event.text));
    syncPanelColumn(event.key);
    return;
  }

  if (event.type === "tool") {
    const runId = getActiveRunId(event.key);
    if (runId) {
      upsertToolBlockByRunId(
        runId,
        event.title,
        event.status,
        event.toolCallId,
      );
    }
    syncPanelColumn(event.key);
    return;
  }

  if (event.type === "error") {
    syncPanelColumn(event.key, { status: "err", error: event.message });
    return;
  }

  finalizePanelStream(event, resolveCtx);
}

function createContextResolver(
  ctxOrResolver?: ExtensionContext | PanelStreamingContextResolver,
): PanelStreamingContextResolver {
  if (typeof ctxOrResolver === "function") return ctxOrResolver;
  return () => ctxOrResolver;
}

function beginPanelStream(
  key: AgentStreamKey,
  requestPreview: string | undefined,
  resolveCtx: PanelStreamingContextResolver,
): void {
  const runId = createRun(key.carrierId, "conn", requestPreview);
  const ctx = resolveCtx();
  const colIndex = findColIndex(key.carrierId);
  activeStreams.set(toStreamKey(key), { ctx, colIndex, runId });
  if (colIndex >= 0 && ctx) beginColStreaming(ctx, colIndex);
  syncPanelColumn(key);
}

function finalizePanelStream(
  event: Extract<AgentStreamEvent, { type: "request_end" }>,
  resolveCtx: PanelStreamingContextResolver,
): void {
  const finalStatus = event.reason === "done" ? "done" : "err";
  const runId = getActiveRunId(event.key);
  if (runId) {
    finalizeRunByRunId(runId, finalStatus, {
      sessionId: event.sessionId,
      error: event.error,
      fallbackText: fallbackTextForEndEvent(event),
      fallbackThinking: event.thoughtText ? sanitizeChunk(event.thoughtText) : undefined,
    });
  }
  syncPanelColumn(event.key);

  const state = activeStreams.get(toStreamKey(event.key));
  const ctx = state?.ctx ?? resolveCtx();
  const colIndex = state?.colIndex ?? findColIndex(event.key.carrierId);
  activeStreams.delete(toStreamKey(event.key));
  if (colIndex >= 0 && ctx && !hasActiveStreamForCarrier(event.key.carrierId)) {
    endColStreaming(ctx, colIndex);
  }
}

function syncPanelColumn(key: AgentStreamKey, override?: { status?: ColStatus; error?: string }): void {
  const colIndex = findColIndex(key.carrierId);
  if (colIndex < 0) return;
  const runId = getActiveRunId(key);
  const run = runId ? getRunById(runId) : undefined;
  if (!run) {
    if (override) updateAgentCol(colIndex, override);
    return;
  }
  updateAgentCol(colIndex, {
    status: override?.status ?? run.status,
    text: run.text,
    thinking: run.thinking,
    toolCalls: run.toolCalls,
    blocks: run.blocks,
    sessionId: run.sessionId,
    error: override?.error ?? run.error,
  });
}

function fallbackTextForEndEvent(event: Extract<AgentStreamEvent, { type: "request_end" }>): string | undefined {
  if (event.reason === "done") return sanitizeChunk(event.responseText || "(no output)");
  if (event.reason === "aborted") return "Aborted.";
  return `Error: ${event.error ?? "unknown"}`;
}

function sanitizeChunk(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\x1b\[\d*[ABCDEFGHJKST]/g, "")
    .replace(/\x1b\[\d*;\d*[Hf]/g, "")
    .replace(/\x1b\[(?:\??\d+[hl]|2J|K)/g, "");
}

function getActiveRunId(key: AgentStreamKey): string | undefined {
  return activeStreams.get(toStreamKey(key))?.runId;
}

function hasActiveStreamForCarrier(carrierId: string): boolean {
  for (const streamKey of activeStreams.keys()) {
    if (streamKey.startsWith(`${carrierId}:`)) return true;
  }
  return false;
}

function toStreamKey(key: AgentStreamKey): string {
  return `${key.carrierId}:${key.cli ?? ""}:${key.requestId ?? ""}`;
}
