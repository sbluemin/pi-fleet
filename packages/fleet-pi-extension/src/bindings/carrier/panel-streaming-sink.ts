import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  AgentColumnKey,
  AgentColumnStream,
  AgentStreamingSink,
} from "@sbluemin/fleet-core/streaming-sink";
import type { ColStatus } from "@sbluemin/fleet-core/bridge/streaming";

import {
  beginColStreaming,
  endColStreaming,
  updateAgentCol,
} from "../../tui/panel-lifecycle.js";
import { findColIndex } from "../../tui/panel/state.js";

export type PanelStreamingContextResolver = () => ExtensionContext | undefined;

interface PanelColumnStream extends AgentColumnStream {
  readonly ctx?: ExtensionContext;
  readonly colIndex: number;
}

export function createPanelStreamingSink(
  ctxOrResolver?: ExtensionContext | PanelStreamingContextResolver,
): AgentStreamingSink {
  const resolveCtx = createContextResolver(ctxOrResolver);

  return {
    onColumnBegin(columnKey) {
      const ctx = resolveCtx();
      const colIndex = findColIndex(columnKey.carrierId);
      if (colIndex >= 0 && ctx) beginColStreaming(ctx, colIndex);
      return {
        columnKey,
        ctx,
        colIndex,
      };
    },
    onColumnUpdate({ carrierId }, update) {
      const colIndex = findColIndex(carrierId);
      if (colIndex >= 0) {
        updateAgentCol(colIndex, {
          ...update,
          status: toPanelStatus(update.status),
        });
      }
    },
    onColumnEnd(columnKey, _reason, stream) {
      const panelStream = toPanelColumnStream(stream);
      const ctx = panelStream?.ctx ?? resolveCtx();
      const colIndex = resolveEndColIndex(columnKey, panelStream);
      if (colIndex >= 0 && ctx) endColStreaming(ctx, colIndex);
    },
  };
}

function createContextResolver(
  ctxOrResolver?: ExtensionContext | PanelStreamingContextResolver,
): PanelStreamingContextResolver {
  if (typeof ctxOrResolver === "function") return ctxOrResolver;
  return () => ctxOrResolver;
}

function toPanelStatus(status: unknown): ColStatus | undefined {
  if (status === "wait" || status === "conn" || status === "stream" || status === "done" || status === "err") {
    return status;
  }
  if (status === "connecting") return "conn";
  if (status === "running") return "stream";
  if (status === "error" || status === "aborted") return "err";
  return undefined;
}

function resolveEndColIndex(
  columnKey: AgentColumnKey,
  stream?: PanelColumnStream,
): number {
  if (stream && sameColumnKey(stream.columnKey, columnKey)) {
    return stream.colIndex;
  }
  return findColIndex(columnKey.carrierId);
}

function sameColumnKey(left: AgentColumnKey, right: AgentColumnKey): boolean {
  return left.carrierId === right.carrierId && left.cli === right.cli;
}

function toPanelColumnStream(stream?: AgentColumnStream): PanelColumnStream | undefined {
  if (!stream || !("colIndex" in stream)) return undefined;
  return stream as PanelColumnStream;
}
