import type { CompletionPushPayload } from "./types.js";
import type { ServiceStatusCallbacks } from "../agent/service-status/store.js";
import type { AgentStreamingSink } from "./streaming-sink.js";

export type { ServiceStatusCallbacks };

export type FleetLogLevel = "debug" | "info" | "warn" | "error";

export interface FleetLogPort {
  (level: FleetLogLevel, message: string, details?: unknown): void;
}

export interface LlmCompleteMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LlmCompleteRequest {
  readonly systemPrompt?: string;
  readonly messages: readonly LlmCompleteMessage[];
  readonly model?: string;
  readonly thinking?: string;
}

export interface LlmCompleteResult {
  readonly text: string;
}

export interface LlmClient {
  complete(request: LlmCompleteRequest): Promise<LlmCompleteResult>;
}

export interface FleetHostPorts {
  /**
   * @deprecated Will be removed in the next minor public-API cycle. Implement `streamingSink` instead.
   */
  appendStreamBlock(columnId: string, block: unknown): void | Promise<void>;
  /**
   * @deprecated Will be removed in the next minor public-API cycle. Implement `streamingSink` instead.
   */
  syncPanelColumn(columnId: string, state: unknown): void | Promise<void>;
  /**
   * @deprecated Will be removed in the next minor public-API cycle. Implement `streamingSink` instead.
   */
  endStreamColumn(columnId: string, reason?: string): void | Promise<void>;
  sendCarrierResultPush(payload: CompletionPushPayload): void | Promise<void>;
  notify(level: FleetLogLevel, message: string): void | Promise<void>;
  loadSetting<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  saveSetting<T = unknown>(key: string, value: T): void | Promise<void>;
  registerKeybind(binding: unknown): (() => void) | Promise<() => void>;
  log: FleetLogPort;
  now(): number;
  getDeliverAs(): string | undefined;
  llmClient?: LlmClient;
  /** Optional callbacks used by hosts that render Fleet service-status state. */
  serviceStatus?: ServiceStatusCallbacks;
  /** Optional sink used by core-owned agent request orchestration to report column lifecycle. */
  streamingSink?: AgentStreamingSink;
}
