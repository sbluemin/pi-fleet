import type { CliType } from "../services/agent/provider-client.js";
import type { AgentStatus, CollectedStreamData } from "../services/agent/types.js";

export interface UnifiedAgentToolCall {
  readonly title: string;
  readonly status: string;
}

export type UnifiedAgentRequestStatus = Extract<AgentStatus, "done" | "error" | "aborted">;

export interface UnifiedAgentRequestOptions {
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

export interface UnifiedAgentBackgroundRequestOptions {
  cli: CliType;
  carrierId: string;
  request: string;
  cwd: string;
  signal?: AbortSignal;
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

export interface UnifiedAgentResult {
  status: UnifiedAgentRequestStatus;
  responseText: string;
  sessionId?: string;
  error?: string;
  thinking?: string;
  toolCalls?: UnifiedAgentToolCall[];
  streamData?: CollectedStreamData;
}

export interface AgentRequestService {
  run(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
  runBackground(options: UnifiedAgentBackgroundRequestOptions): Promise<UnifiedAgentResult>;
}

export { createAgentRequestService } from "../services/agent/request/service.js";
