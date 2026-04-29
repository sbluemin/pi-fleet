import type { CliType } from "@sbluemin/unified-agent";
import type { AgentStatus } from "../agent/types.js";
import type { CollectedStreamData } from "../bridge/streaming/types.js";

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
  thinking?: CollectedStreamData["thinking"];
  toolCalls?: CollectedStreamData["toolCalls"];
  blocks?: CollectedStreamData["blocks"];
}

export interface AgentRequestService {
  run(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
  runBackground(options: UnifiedAgentBackgroundRequestOptions): Promise<UnifiedAgentResult>;
}

export { createAgentRequestService } from "../agent/request/service.js";
