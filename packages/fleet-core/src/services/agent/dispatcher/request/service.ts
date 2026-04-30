import { executeWithPool } from "../executor.js";
import type {
  AgentStatus,
  AgentStreamEvent,
  AgentStreamKey,
  CollectedStreamData,
} from "../../shared/types.js";
import { loadModels as getModelConfig } from "../../../../admiral/store/index.js";
import type {
  UnifiedAgentBackgroundRequestOptions,
  UnifiedAgentRequestOptions,
  UnifiedAgentRequestStatus,
  UnifiedAgentResult,
} from "../../../../public/agent-services.js";
import type {
  AgentStreamingSink,
} from "../../../../public/agent-services.js";

interface AgentRequestServiceOptions {
  readonly streamingSink?: AgentStreamingSink;
}

interface AgentRequestService {
  run(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
  runBackground(options: UnifiedAgentBackgroundRequestOptions): Promise<UnifiedAgentResult>;
}

interface ExecuteAgentCoreOptions {
  readonly options: UnifiedAgentRequestOptions | UnifiedAgentBackgroundRequestOptions;
  readonly emitStreamEvents: boolean;
  readonly sink?: AgentStreamingSink;
}

interface StreamEventQueue {
  pending: Promise<void>;
}

const streamRequestState = { counter: 0 };

export function createAgentRequestService(options: AgentRequestServiceOptions = {}): AgentRequestService {
  return {
    run(requestOptions) {
      return executeAgentCore({
        options: requestOptions,
        emitStreamEvents: true,
        sink: options.streamingSink,
      });
    },
    runBackground(requestOptions) {
      return executeAgentCore({
        options: requestOptions,
        emitStreamEvents: false,
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
  const streamKey: AgentStreamKey = { carrierId, cli, requestId: createStreamRequestId(carrierId) };
  const requestPreview = request?.trim().split(/\r?\n/, 1)[0];
  const eventQueue: StreamEventQueue = { pending: Promise.resolve() };

  if (coreOptions.emitStreamEvents) {
    queueStreamEvent(coreOptions, eventQueue, {
      type: "request_begin",
      key: streamKey,
      requestPreview,
    });
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
        queueStreamEvent(coreOptions, eventQueue, {
          type: "message",
          key: streamKey,
          text,
        });
        onMessageChunk?.(text);
      },
      onThoughtChunk: (text: string) => {
        queueStreamEvent(coreOptions, eventQueue, {
          type: "thought",
          key: streamKey,
          text,
        });
        onThoughtChunk?.(text);
      },
      onToolCall: (
        title: string,
        status: string,
        rawOutput?: string,
        toolCallId?: string,
      ) => {
        queueStreamEvent(coreOptions, eventQueue, {
          type: "tool",
          key: streamKey,
          title,
          status,
          toolCallId,
        });
        onToolCall?.(title, status, rawOutput, toolCallId);
      },
      onStatusChange: (status: AgentStatus) => {
        queueStreamEvent(coreOptions, eventQueue, {
          type: "status",
          key: streamKey,
          status,
        });
      },
    });

    const finalStatus = toFinalStatus(result.status);
    const sessionId = result.connectionInfo.sessionId;
    queueStreamEvent(coreOptions, eventQueue, {
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
    queueStreamEvent(coreOptions, eventQueue, {
      type: "error",
      key: streamKey,
      message,
    });
    queueStreamEvent(coreOptions, eventQueue, {
      type: "request_end",
      key: streamKey,
      reason: "error",
      error: message,
      responseText: `Error: ${message}`,
      streamData: createErrorStreamData(message),
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

function createErrorStreamData(message: string): CollectedStreamData {
  const responseText = `Error: ${message}`;
  return {
    text: responseText,
    thinking: "",
    toolCalls: [],
    blocks: [{ type: "text" as const, text: responseText }],
    lastStatus: "error" as const,
  };
}

function toFinalStatus(status: AgentStatus): UnifiedAgentRequestStatus {
  if (status === "done" || status === "aborted") {
    return status;
  }
  return "error";
}

function queueStreamEvent(
  options: ExecuteAgentCoreOptions,
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
