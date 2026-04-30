import type {
  AgentStreamEndReason,
  AgentStreamEvent,
  AgentStreamKey,
  AgentStreamToolEvent,
  CliType,
  ColBlock,
  ColStatus,
  CollectedStreamData,
} from "./types.js";

export type FleetConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "initializing"
  | "ready"
  | "error"
  | "closed";

export interface FleetMcpConfig {
  type: "http";
  name: string;
  url: string;
  headers?: { name: string; value: string }[];
  toolTimeout?: number;
}

export interface FleetProviderConnectOptions {
  cwd: string;
  cli?: CliType;
  model?: string;
  autoApprove?: boolean;
  clientInfo?: {
    name: string;
    version: string;
  };
  timeout?: number;
  yoloMode?: boolean;
  env?: Record<string, string>;
  promptIdleTimeout?: number;
  sessionId?: string;
  systemPrompt?: string;
  mcpServers?: FleetMcpConfig[];
}

export interface FleetAcpSessionInfo {
  sessionId?: string;
}

export interface FleetProviderConnectResult {
  cli: CliType;
  protocol: string;
  session?: FleetAcpSessionInfo;
}

export interface FleetProviderConnectionInfo {
  cli: CliType | null;
  protocol: string | null;
  sessionId: string | null;
  state: FleetConnectionState;
}

export interface FleetAcpContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface FleetAcpToolCall {
  kind?: string;
  rawInput?: unknown;
  [key: string]: unknown;
}

export interface FleetAcpToolCallUpdate {
  content?: unknown;
  rawOutput?: unknown;
  tool?: unknown;
  [key: string]: unknown;
}

export interface FleetProviderLogEntry {
  message: string;
  cli?: string;
  sessionId?: string;
}

export interface FleetAgentClientEvents {
  messageChunk: [text: string, sessionId: string];
  thoughtChunk: [text: string, sessionId: string];
  toolCall: [title: string, status: string, sessionId: string, data?: FleetAcpToolCall];
  toolCallUpdate: [title: string, status: string, sessionId: string, data?: FleetAcpToolCallUpdate];
  promptComplete: [sessionId: string];
  error: [error: Error];
  exit: [code: number | null, signal: string | null];
  logEntry: [entry: FleetProviderLogEntry];
}

export interface FleetAgentClient {
  on<K extends keyof FleetAgentClientEvents>(
    event: K,
    listener: (...args: FleetAgentClientEvents[K]) => void,
  ): FleetAgentClient;
  off<K extends keyof FleetAgentClientEvents>(
    event: K,
    listener: (...args: FleetAgentClientEvents[K]) => void,
  ): FleetAgentClient;
  connect(options: FleetProviderConnectOptions): Promise<FleetProviderConnectResult>;
  disconnect(): Promise<void>;
  sendMessage(content: string | FleetAcpContentBlock[]): Promise<unknown>;
  cancelPrompt(): Promise<void>;
  endSession(): Promise<void>;
  removeAllListeners(event?: keyof FleetAgentClientEvents): FleetAgentClient;
  getConnectionInfo(): FleetProviderConnectionInfo;
  setModel(model: string): Promise<void>;
  setConfigOption(configId: string, value: string): Promise<void>;
  getCurrentSystemPrompt(): string | null | undefined;
}

export type {
  AgentStreamEndReason,
  AgentStreamEvent,
  AgentStreamKey,
  AgentStreamToolEvent,
  CliType,
  ColBlock,
  ColStatus,
  CollectedStreamData,
};
