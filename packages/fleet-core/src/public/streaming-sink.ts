import type { CliType } from "@sbluemin/unified-agent";
import type { AgentStatus } from "../agent/types.js";
import type { ColStatus } from "../bridge/run-stream/types.js";
import type { CollectedStreamData } from "../bridge/run-stream/types.js";

export type AgentColumnEndReason = "done" | "error" | "aborted";

export interface AgentColumnKey {
  readonly carrierId: string;
  readonly cli?: CliType;
}

export interface AgentColumnUpdate {
  readonly status?: AgentStatus | ColStatus;
  readonly text?: string;
  readonly thinking?: CollectedStreamData["thinking"];
  readonly toolCalls?: CollectedStreamData["toolCalls"];
  readonly toolCount?: number;
  readonly blocks?: CollectedStreamData["blocks"];
  readonly sessionId?: string;
  readonly error?: string;
}

export interface AgentColumnStream {
  readonly columnKey: AgentColumnKey;
}

export interface AgentStreamingSink {
  onColumnBegin(columnKey: AgentColumnKey): void | AgentColumnStream | Promise<void | AgentColumnStream>;
  onColumnUpdate(columnKey: AgentColumnKey, update: AgentColumnUpdate): void | Promise<void>;
  onColumnEnd(columnKey: AgentColumnKey, reason: AgentColumnEndReason, stream?: AgentColumnStream): void | Promise<void>;
}
