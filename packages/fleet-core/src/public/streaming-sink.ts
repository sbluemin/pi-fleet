import type { AgentStreamEvent } from "../services/agent/types.js";

export type {
  AgentStreamEndReason,
  AgentStreamEvent,
  AgentStreamKey,
  AgentStreamToolEvent,
  ColBlock,
  ColStatus,
  CollectedStreamData,
} from "../services/agent/types.js";

export interface AgentStreamingSink {
  onAgentStreamEvent(event: AgentStreamEvent): void | Promise<void>;
}
