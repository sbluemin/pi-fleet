import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import { executeWithPool } from "@sbluemin/fleet-core/agent";
import type { AgentStatus, ToolCallInfo } from "@sbluemin/fleet-core/agent";
import { getSessionStore } from "@sbluemin/fleet-core/agent/runtime";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  updateRunStatus,
  finalizeRun,
  getRunById,
  getVisibleRun,
} from "@sbluemin/fleet-core/bridge/streaming";
import type { CollectedStreamData } from "@sbluemin/fleet-core/bridge/streaming";
import { loadModels as getModelConfig } from "@sbluemin/fleet-core/store";

import {
  beginColStreaming,
  endColStreaming,
  updateAgentCol,
} from "../../tui/panel-lifecycle.js";
import { findColIndex } from "../../tui/panel/state.js";

export type UnifiedAgentRequestStatus = Extract<AgentStatus, "done" | "error" | "aborted">;

export interface UnifiedAgentRequestOptions {
  cli: CliType;
  carrierId: string;
  request: string;
  ctx: ExtensionContext;
  signal?: AbortSignal;
  cwd?: string;
  onMessageChunk?: (text: string) => void;
  onThoughtChunk?: (text: string) => void;
  onToolCall?: (
    title: string,
    status: string,
    rawOutput?: string,
    toolCallId?: string,
  ) => void;
}

export interface UnifiedAgentBackgroundRequestOptions {
  cli: CliType;
  carrierId: string;
  request: string;
  cwd: string;
  signal?: AbortSignal;
  onMessageChunk?: (text: string) => void;
  onThoughtChunk?: (text: string) => void;
  onToolCall?: (
    title: string,
    status: string,
    rawOutput?: string,
    toolCallId?: string,
  ) => void;
}

export interface UnifiedAgentResult {
  status: UnifiedAgentRequestStatus;
  responseText: string;
  sessionId?: string;
  error?: string;
  thinking?: CollectedStreamData["thinking"];
  toolCalls?: CollectedStreamData["toolCalls"];
  blocks?: CollectedStreamData["blocks"];
}

export interface UnifiedAgentRequestBridge {
  requestUnifiedAgent(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
}

interface RunAgentRequestOptions extends UnifiedAgentRequestOptions {
  connectSystemPrompt?: string | null;
}

interface RunAgentRequestBackgroundOptions extends UnifiedAgentBackgroundRequestOptions {
  connectSystemPrompt?: string | null;
}

interface ExecuteAgentCoreOptions {
  cli: RunAgentRequestOptions["cli"];
  carrierId: string;
  request: string;
  cwd: string;
  signal?: AbortSignal;
  connectSystemPrompt?: string | null;
  syncPanel: boolean;
  colIndex: number;
  onMessageChunk?: (text: string) => void;
  onThoughtChunk?: (text: string) => void;
  onToolCall?: (
    title: string,
    status: string,
    rawOutput?: string,
    toolCallId?: string,
  ) => void;
}

const UNIFIED_AGENT_REQUEST_KEY = "__pi_ua_request__";

export async function runAgentRequest(options: RunAgentRequestOptions): Promise<UnifiedAgentResult> {
  const carrierId = options.carrierId;
  const colIndex = findColIndex(carrierId);
  if (colIndex >= 0) {
    beginColStreaming(options.ctx, colIndex);
  }
  try {
    return await executeAgentCore({
      ...options,
      carrierId,
      cwd: options.cwd ?? options.ctx.cwd,
      colIndex,
      syncPanel: true,
    });
  } finally {
    if (colIndex >= 0) {
      endColStreaming(options.ctx, colIndex);
    }
  }
}

export async function runAgentRequestBackground(options: RunAgentRequestBackgroundOptions): Promise<UnifiedAgentResult> {
  return executeAgentCore({
    ...options,
    colIndex: findColIndex(options.carrierId),
    syncPanel: true,
  });
}

export function exposeAgentApi(): UnifiedAgentRequestBridge {
  const bridge: UnifiedAgentRequestBridge = {
    requestUnifiedAgent: (options) =>
      runAgentRequest({
        ...options,
      }),
  };

  (globalThis as Record<string, unknown>)[UNIFIED_AGENT_REQUEST_KEY] = bridge;
  return bridge;
}

async function executeAgentCore(options: ExecuteAgentCoreOptions): Promise<UnifiedAgentResult> {
  const {
    cli,
    request,
    signal,
    cwd,
    onMessageChunk,
    onThoughtChunk,
    onToolCall,
  } = options;

  const carrierId = options.carrierId;
  const colIndex = options.colIndex;
  const requestPreview = request?.trim().split(/\r?\n/, 1)[0];
  const runId = createRun(carrierId, "conn", requestPreview);

  try {
    const cliConfig = getModelConfig()[carrierId];
    const result = await executeWithPool({
      carrierId,
      cliType: cli,
      request,
      cwd,
      model: cliConfig?.model,
      effort: cliConfig?.effort,
      budgetTokens: cliConfig?.budgetTokens,
      connectSystemPrompt: options.connectSystemPrompt,
      signal,
      onMessageChunk: (text: string) => {
        appendTextBlock(carrierId, sanitizeChunk(text));
        if (options.syncPanel) syncColFromStore(carrierId, colIndex);
        onMessageChunk?.(text);
      },
      onThoughtChunk: (text: string) => {
        appendThoughtBlock(carrierId, sanitizeChunk(text));
        if (options.syncPanel) syncColFromStore(carrierId, colIndex);
        onThoughtChunk?.(text);
      },
      onToolCall: (
        title: string,
        status: string,
        rawOutput?: string,
        toolCallId?: string,
      ) => {
        upsertToolBlock(carrierId, title, status, toolCallId);
        if (options.syncPanel) syncColFromStore(carrierId, colIndex);
        onToolCall?.(title, status, rawOutput, toolCallId);
      },
      onStatusChange: (status: AgentStatus) => {
        updateRunStatus(carrierId, status);
        if (options.syncPanel) syncColFromStore(carrierId, colIndex);
      },
    });

    const finalStatus = toFinalStatus(result.status);
    const sessionId = result.connectionInfo.sessionId;

    if (finalStatus === "done") {
      finalizeRun(carrierId, "done", {
        sessionId,
        fallbackText: result.responseText || "(no output)",
        fallbackThinking: result.thoughtText,
      });
    } else if (finalStatus === "aborted") {
      finalizeRun(carrierId, "err", {
        sessionId,
        error: "aborted",
        fallbackText: "Aborted.",
        fallbackThinking: result.thoughtText,
      });
    } else {
      finalizeRun(carrierId, "err", {
        sessionId,
        error: result.error,
        fallbackText: `Error: ${result.error ?? "unknown"}`,
        fallbackThinking: result.thoughtText,
      });
    }
    if (options.syncPanel) syncColFromStore(carrierId, colIndex);

    const run = getRunById(runId);
    const collected = run
      ? run.toCollectedData()
      : {
        text: "",
        thinking: "",
        toolCalls: [] as ToolCallInfo[],
        blocks: [],
        lastStatus: "connecting" as const,
      };

    return {
      status: finalStatus,
      responseText: result.responseText,
      sessionId: sessionId ?? undefined,
      error: result.error,
      thinking: collected.thinking || undefined,
      toolCalls: collected.toolCalls.length > 0 ? collected.toolCalls : undefined,
      blocks: collected.blocks.length > 0 ? collected.blocks : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finalizeRun(carrierId, "err", { error: message, fallbackText: `Error: ${message}` });
    if (options.syncPanel) syncColFromStore(carrierId, colIndex);
    throw error;
  }
}

function toFinalStatus(status: AgentStatus): UnifiedAgentRequestStatus {
  if (status === "done" || status === "aborted") {
    return status;
  }
  return "error";
}

function sanitizeChunk(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\x1b\[\d*[ABCDEFGHJKST]/g, "")
    .replace(/\x1b\[\d*;\d*[Hf]/g, "")
    .replace(/\x1b\[(?:\??\d+[hl]|2J|K)/g, "");
}

function syncColFromStore(cli: string, colIndex: number): void {
  if (colIndex < 0) return;
  const run = getVisibleRun(cli);
  if (!run) return;
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;
  updateAgentCol(colIndex, {
    status: run.status,
    text: run.text,
    thinking: run.thinking,
    toolCalls: run.toolCalls,
    blocks: run.blocks,
    sessionId: run.sessionId ?? sessionMap[cli],
    error: run.error,
  });
}
