/**
 * agent/provider-client.ts — provider 계층용 unified-agent 어댑터
 *
 * Pi 확장은 이 파일의 public API만 소비하고 raw unified-agent API는 fleet-core 안에 숨긴다.
 */

import {
  UnifiedAgent,
  getReasoningEffortLevels,
  getModelsRegistry,
} from "@sbluemin/unified-agent";
import type {
  AgentStreamEndReason,
  AgentStreamEvent,
  AgentStreamKey,
  AgentStreamToolEvent,
  ColBlock,
  ColStatus,
  CollectedStreamData,
} from "../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

export type CliType = "claude" | "codex" | "gemini";

export type FleetConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "initializing"
  | "ready"
  | "error"
  | "closed";

type UnifiedAgentClient = Awaited<ReturnType<typeof UnifiedAgent.build>>;

type UnifiedAgentConnectOptions = Parameters<UnifiedAgentClient["connect"]>[0];

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

export interface ProviderClientBuildOptions {
  cli: CliType;
  sessionId?: string;
}

export interface ProviderModelEntry {
  modelId: string;
  name: string;
  description?: string;
}

export type ProviderReasoningEffort =
  | { supported: true; levels: string[]; default: string }
  | { supported: false };

export interface ProviderModelInfo {
  name: string;
  defaultModel: string;
  models: ProviderModelEntry[];
  reasoningEffort: ProviderReasoningEffort;
}

export interface ProviderModelsRegistry {
  version: number;
  updatedAt: string;
  providers: Record<string, ProviderModelInfo>;
}

export type {
  AgentStreamEndReason,
  AgentStreamEvent,
  AgentStreamKey,
  AgentStreamToolEvent,
  ColBlock,
  ColStatus,
  CollectedStreamData,
};

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

export function getProviderModelsRegistry(): ProviderModelsRegistry {
  return getModelsRegistry() as ProviderModelsRegistry;
}

export function supportsProviderReasoningEffort(cli: CliType): boolean {
  const levels = getReasoningEffortLevels(cli);
  return Array.isArray(levels) && levels.length > 0;
}

export async function buildProviderClient(
  options: ProviderClientBuildOptions,
): Promise<FleetAgentClient> {
  const client = await UnifiedAgent.build(options);
  return new UnifiedFleetAgentClientAdapter(client);
}

class UnifiedFleetAgentClientAdapter implements FleetAgentClient {
  constructor(private readonly inner: UnifiedAgentClient) {}

  on<K extends keyof FleetAgentClientEvents>(
    event: K,
    listener: (...args: FleetAgentClientEvents[K]) => void,
  ): FleetAgentClient {
    this.inner.on(event as never, listener as never);
    return this;
  }

  off<K extends keyof FleetAgentClientEvents>(
    event: K,
    listener: (...args: FleetAgentClientEvents[K]) => void,
  ): FleetAgentClient {
    this.inner.off(event as never, listener as never);
    return this;
  }

  connect(options: FleetProviderConnectOptions): Promise<FleetProviderConnectResult> {
    return this.inner.connect(options as UnifiedAgentConnectOptions) as Promise<FleetProviderConnectResult>;
  }

  disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  sendMessage(content: string | FleetAcpContentBlock[]): Promise<unknown> {
    return this.inner.sendMessage(content as never);
  }

  cancelPrompt(): Promise<void> {
    return this.inner.cancelPrompt();
  }

  endSession(): Promise<void> {
    return this.inner.endSession();
  }

  removeAllListeners(event?: keyof FleetAgentClientEvents): FleetAgentClient {
    this.inner.removeAllListeners(event as never);
    return this;
  }

  getConnectionInfo(): FleetProviderConnectionInfo {
    return this.inner.getConnectionInfo() as FleetProviderConnectionInfo;
  }

  setModel(model: string): Promise<void> {
    return this.inner.setModel(model);
  }

  setConfigOption(configId: string, value: string): Promise<void> {
    return this.inner.setConfigOption(configId, value);
  }

  getCurrentSystemPrompt(): string | null | undefined {
    return this.inner.getCurrentSystemPrompt();
  }
}
