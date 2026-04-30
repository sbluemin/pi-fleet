import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadModels as getModelConfig } from "@sbluemin/fleet-core/admiral/store";
import {
  executeWithPool,
  type AgentStreamEvent,
  type AgentStreamKey,
  type AgentStatus,
  type CollectedStreamData,
} from "@sbluemin/fleet-core/admiral/agent-runtime";
import type { CliType } from "@sbluemin/unified-agent";

import { createPanelStreamingSink } from "./ui/agent-panel/streaming-sink.js";

export type UnifiedAgentRequestStatus = "done" | "error" | "aborted";

export interface UnifiedAgentToolCall {
  readonly title: string;
  readonly status: string;
}

export interface UnifiedAgentRequestOptionsBase {
  cli: CliType;
  carrierId: string;
  request: string;
  signal?: AbortSignal;
  cwd?: string;
  connectSystemPrompt?: string | null;
  onMessageChunk?: (text: string) => void;
  onThoughtChunk?: (text: string) => void;
  onToolCall?: (
    title: string,
    status: string,
    rawOutput?: string,
    toolCallId?: string,
  ) => void;
}

export interface UnifiedAgentBackgroundRequestOptions extends UnifiedAgentRequestOptionsBase {
  cwd: string;
}

export interface UnifiedAgentResult {
  status: UnifiedAgentRequestStatus;
  responseText: string;
  sessionId?: string;
  error?: string;
  thinking?: string;
  toolCalls?: UnifiedAgentToolCall[];
  streamData?: CollectedStreamData;
}

export interface UnifiedAgentRequestOptions extends UnifiedAgentRequestOptionsBase {
  ctx: ExtensionContext;
}

export interface UnifiedAgentRequestBridge {
  requestUnifiedAgent(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
}

type RunAgentRequestOptions = UnifiedAgentRequestOptions;

interface StreamEventQueue {
  pending: Promise<void>;
}

const streamRequestState = { counter: 0 };

export async function runAgentRequest(options: RunAgentRequestOptions): Promise<UnifiedAgentResult> {
  return executeAgentRequest(toCoreOptions(options), {
    emitStreamEvents: true,
    sink: createPanelStreamingSink(() => hasPanelUi(options.ctx) ? options.ctx : undefined),
  });
}

export function exposeAgentApi(): UnifiedAgentRequestBridge {
  const bridge: UnifiedAgentRequestBridge = {
    requestUnifiedAgent: (options) =>
      runAgentRequest({
        ...options,
      }),
  };

  return bridge;
}

function toCoreOptions(options: RunAgentRequestOptions): UnifiedAgentRequestOptionsBase {
  const { ctx, cwd, ...rest } = options;
  return {
    ...rest,
    cwd: cwd ?? ctx.cwd,
  };
}

function hasPanelUi(ctx: ExtensionContext): boolean {
  return typeof (ctx as { ui?: { setWidget?: unknown } }).ui?.setWidget === "function";
}

async function executeAgentRequest(
  options: UnifiedAgentRequestOptionsBase,
  streamOptions: {
    emitStreamEvents: boolean;
    sink?: { onAgentStreamEvent(event: AgentStreamEvent): void | Promise<void> };
  },
): Promise<UnifiedAgentResult> {
  const {
    carrierId,
    cli,
    request,
    signal,
    cwd,
    onMessageChunk,
    onThoughtChunk,
    onToolCall,
  } = options;
  const streamKey: AgentStreamKey = { carrierId, cli, requestId: createStreamRequestId(carrierId) };
  const eventQueue: StreamEventQueue = { pending: Promise.resolve() };
  const requestPreview = request.trim().split(/\r?\n/, 1)[0];

  queueStreamEvent(streamOptions, eventQueue, {
    type: "request_begin",
    key: streamKey,
    requestPreview,
  });

  try {
    const cliConfig = getModelConfig()[carrierId];
    const result = await executeWithPool({
      carrierId,
      cliType: cli,
      request,
      cwd: cwd ?? process.cwd(),
      model: cliConfig?.model,
      effort: cliConfig?.effort,
      budgetTokens: cliConfig?.budgetTokens,
      connectSystemPrompt: options.connectSystemPrompt,
      signal,
      onMessageChunk: (text) => {
        queueStreamEvent(streamOptions, eventQueue, {
          type: "message",
          key: streamKey,
          text,
        });
        onMessageChunk?.(text);
      },
      onThoughtChunk: (text) => {
        queueStreamEvent(streamOptions, eventQueue, {
          type: "thought",
          key: streamKey,
          text,
        });
        onThoughtChunk?.(text);
      },
      onToolCall: (title, status, rawOutput, toolCallId) => {
        queueStreamEvent(streamOptions, eventQueue, {
          type: "tool",
          key: streamKey,
          title,
          status,
          toolCallId,
        });
        onToolCall?.(title, status, rawOutput, toolCallId);
      },
      onStatusChange: (status) => {
        queueStreamEvent(streamOptions, eventQueue, {
          type: "status",
          key: streamKey,
          status,
        });
      },
    });

    const finalStatus = toFinalStatus(result.status);
    const sessionId = result.connectionInfo.sessionId;
    queueStreamEvent(streamOptions, eventQueue, {
      type: "request_end",
      key: streamKey,
      reason: finalStatus,
      sessionId: sessionId ?? undefined,
      responseText: result.responseText,
      thoughtText: result.thoughtText,
      streamData: result.streamData,
      error: finalStatus === "aborted" ? "aborted" : result.error,
    });
    await settleStreamEvents(eventQueue);

    return {
      status: finalStatus,
      responseText: result.responseText,
      sessionId: sessionId ?? undefined,
      error: result.error,
      thinking: result.thoughtText || undefined,
      toolCalls: result.toolCalls.length > 0
        ? result.toolCalls.map((toolCall) => ({
          title: toolCall.title,
          status: toolCall.status,
        }))
        : undefined,
      streamData: result.streamData,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    queueStreamEvent(streamOptions, eventQueue, {
      type: "error",
      key: streamKey,
      message,
    });
    queueStreamEvent(streamOptions, eventQueue, {
      type: "request_end",
      key: streamKey,
      reason: "error",
      error: message,
      responseText: `Error: ${message}`,
    });
    await settleStreamEvents(eventQueue);
    throw error;
  } finally {
    await settleStreamEvents(eventQueue);
  }
}

function createStreamRequestId(carrierId: string): string {
  streamRequestState.counter += 1;
  return `${carrierId}-${Date.now().toString(36)}-${streamRequestState.counter.toString(36)}`;
}

function toFinalStatus(status: AgentStatus): UnifiedAgentRequestStatus {
  if (status === "done" || status === "aborted") {
    return status;
  }
  return "error";
}

function queueStreamEvent(
  options: { emitStreamEvents: boolean; sink?: { onAgentStreamEvent(event: AgentStreamEvent): void | Promise<void> } },
  queue: StreamEventQueue,
  event: AgentStreamEvent,
): void {
  if (!options.emitStreamEvents || !options.sink) return;
  queue.pending = queue.pending
    .catch(() => undefined)
    .then(() => callSink(() => options.sink?.onAgentStreamEvent(event)));
}

async function settleStreamEvents(queue: StreamEventQueue): Promise<void> {
  await queue.pending.catch(() => undefined);
}

async function callSink<T>(call: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch {
    return undefined;
  }
}
