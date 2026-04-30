import { executeWithPool } from "../executor.js";
import type { AgentStatus, ToolCallInfo } from "../types.js";
import { getSessionStore } from "../runtime.js";
import {
  appendTextBlock,
  appendThoughtBlock,
  createRun,
  finalizeRun,
  getRunById,
  getVisibleRun,
  updateRunStatus,
  upsertToolBlock,
} from "../../bridge/run-stream/index.js";
import { loadModels as getModelConfig } from "../../store/index.js";
import type {
  AgentRequestService,
  UnifiedAgentBackgroundRequestOptions,
  UnifiedAgentRequestOptions,
  UnifiedAgentRequestStatus,
  UnifiedAgentResult,
} from "../../public/agent-request.js";
import type {
  AgentColumnEndReason,
  AgentColumnKey,
  AgentColumnStream,
  AgentColumnUpdate,
  AgentStreamingSink,
} from "../../public/streaming-sink.js";

interface AgentRequestServiceOptions {
  readonly streamingSink?: AgentStreamingSink;
}

interface ExecuteAgentCoreOptions {
  readonly options: UnifiedAgentRequestOptions | UnifiedAgentBackgroundRequestOptions;
  readonly syncColumn: boolean;
  readonly emitColumnLifecycle: boolean;
  readonly sink?: AgentStreamingSink;
}

interface ColumnSyncQueue {
  pending: Promise<void>;
}

export function createAgentRequestService(options: AgentRequestServiceOptions = {}): AgentRequestService {
  return {
    run(requestOptions) {
      return executeAgentCore({
        options: requestOptions,
        syncColumn: true,
        emitColumnLifecycle: true,
        sink: options.streamingSink,
      });
    },
    runBackground(requestOptions) {
      return executeAgentCore({
        options: requestOptions,
        syncColumn: true,
        emitColumnLifecycle: false,
        sink: undefined,
      });
    },
  };
}

async function executeAgentCore(coreOptions: ExecuteAgentCoreOptions): Promise<UnifiedAgentResult> {
  const { options, sink } = coreOptions;
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
  const columnKey: AgentColumnKey = { carrierId, cli };
  const requestPreview = request?.trim().split(/\r?\n/, 1)[0];
  const runId = createRun(carrierId, "conn", requestPreview);
  const syncQueue: ColumnSyncQueue = { pending: Promise.resolve() };
  let endReason: AgentColumnEndReason = "error";
  let columnStream: AgentColumnStream | undefined;

  if (coreOptions.emitColumnLifecycle) {
    columnStream = toColumnStream(await callSink(() => sink?.onColumnBegin(columnKey)));
  }

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
      onMessageChunk: (text: string) => {
        appendTextBlock(carrierId, sanitizeChunk(text));
        queueColumnSync(coreOptions, columnKey, syncQueue);
        onMessageChunk?.(text);
      },
      onThoughtChunk: (text: string) => {
        appendThoughtBlock(carrierId, sanitizeChunk(text));
        queueColumnSync(coreOptions, columnKey, syncQueue);
        onThoughtChunk?.(text);
      },
      onToolCall: (
        title: string,
        status: string,
        rawOutput?: string,
        toolCallId?: string,
      ) => {
        upsertToolBlock(carrierId, title, status, toolCallId);
        queueColumnSync(coreOptions, columnKey, syncQueue);
        onToolCall?.(title, status, rawOutput, toolCallId);
      },
      onStatusChange: (status: AgentStatus) => {
        updateRunStatus(carrierId, status);
        queueColumnSync(coreOptions, columnKey, syncQueue);
      },
    });

    const finalStatus = toFinalStatus(result.status);
    const sessionId = result.connectionInfo.sessionId;
    endReason = finalStatus;

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
    await flushColumnSync(coreOptions, columnKey, syncQueue);

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
    await flushColumnSync(coreOptions, columnKey, syncQueue);
    throw error;
  } finally {
    await settleColumnSync(syncQueue);
    if (coreOptions.emitColumnLifecycle) {
      await callSink(() => sink?.onColumnEnd(columnKey, endReason, columnStream));
    }
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

function queueColumnSync(
  options: ExecuteAgentCoreOptions,
  columnKey: AgentColumnKey,
  queue: ColumnSyncQueue,
): void {
  if (!options.syncColumn || !options.sink) return;
  const update = readColumnUpdate(columnKey);
  if (!update) return;
  queue.pending = queue.pending
    .catch(() => undefined)
    .then(() => callSink(() => options.sink?.onColumnUpdate(columnKey, update)));
}

async function flushColumnSync(
  options: ExecuteAgentCoreOptions,
  columnKey: AgentColumnKey,
  queue: ColumnSyncQueue,
): Promise<void> {
  await settleColumnSync(queue);
  queueColumnSync(options, columnKey, queue);
  await settleColumnSync(queue);
}

async function settleColumnSync(queue: ColumnSyncQueue): Promise<void> {
  await queue.pending.catch(() => undefined);
}

async function callSink<T>(call: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch {
    return undefined;
  }
}

function toColumnStream(stream: void | AgentColumnStream | undefined): AgentColumnStream | undefined {
  return stream ?? undefined;
}

function readColumnUpdate(columnKey: AgentColumnKey): AgentColumnUpdate | undefined {
  const run = getVisibleRun(columnKey.carrierId);
  if (!run) return undefined;
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;
  return {
    status: run.status,
    text: run.text,
    thinking: run.thinking,
    toolCalls: run.toolCalls,
    blocks: run.blocks,
    sessionId: run.sessionId ?? sessionMap[columnKey.carrierId],
    error: run.error,
  };
}
