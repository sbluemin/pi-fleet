/**
 * agent/provider/client.ts — provider 계층용 unified-agent 어댑터
 *
 * Pi 확장은 이 파일의 public API만 소비하고 raw unified-agent API는 fleet-core 안에 숨긴다.
 */

import {
  UnifiedAgent,
  getReasoningEffortLevels,
  getModelsRegistry,
} from "@sbluemin/unified-agent";
import type {
  CliType,
  FleetAcpContentBlock,
  FleetAgentClient,
  FleetAgentClientEvents,
  FleetProviderConnectOptions,
  FleetProviderConnectResult,
  FleetProviderConnectionInfo,
} from "../shared/client.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

type UnifiedAgentClient = Awaited<ReturnType<typeof UnifiedAgent.build>>;

type UnifiedAgentConnectOptions = Parameters<UnifiedAgentClient["connect"]>[0];

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
  CliType,
  FleetAcpContentBlock,
  FleetAcpSessionInfo,
  FleetAcpToolCall,
  FleetAcpToolCallUpdate,
  FleetAgentClient,
  FleetAgentClientEvents,
  FleetConnectionState,
  FleetMcpConfig,
  FleetProviderConnectOptions,
  FleetProviderConnectResult,
  FleetProviderConnectionInfo,
  FleetProviderLogEntry,
} from "../shared/client.js";

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
