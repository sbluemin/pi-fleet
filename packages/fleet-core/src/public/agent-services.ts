import type { CliType } from "../services/agent/provider-client.js";
import type { ServiceStatusCallbacks } from "../services/agent/service-status/store.js";
import type {
  AgentStatus,
  AgentStreamEvent,
  CollectedStreamData,
} from "../services/agent/types.js";

export type {
  AgentStreamEvent,
  AgentStreamKey,
  ColBlock,
  ColStatus,
} from "../services/agent/types.js";
export type { ServiceStatusCallbacks } from "../services/agent/service-status/store.js";

interface UnifiedAgentToolCall {
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

interface CompletionPushPayload {
  readonly jobId: string;
  readonly carrierId: string;
  readonly title: string;
  readonly content: string;
  readonly details?: unknown;
}

type FleetLogLevel = "debug" | "info" | "warn" | "error";

export interface FleetLogPort {
  (level: FleetLogLevel, message: string, details?: unknown): void;
}

export interface FleetHostPorts {
  sendCarrierResultPush(payload: CompletionPushPayload): void | Promise<void>;
  notify(level: FleetLogLevel, message: string): void | Promise<void>;
  loadSetting<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  saveSetting<T = unknown>(key: string, value: T): void | Promise<void>;
  registerKeybind(binding: unknown): (() => void) | Promise<() => void>;
  log: FleetLogPort;
  now(): number;
  getDeliverAs(): string | undefined;
  serviceStatus?: ServiceStatusCallbacks;
  streamingSink?: AgentStreamingSink;
}

export interface BackendConnectOptions {
  readonly cwd: string;
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export interface BackendRequest {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Record<string, unknown>;
}

export interface BackendResponse {
  readonly text: string;
  readonly raw?: unknown;
}

export interface BackendSession {
  request(request: BackendRequest): AsyncIterable<BackendResponse> | Promise<BackendResponse>;
  close(): Promise<void>;
}

export interface BackendAdapter {
  connect(options: BackendConnectOptions): Promise<BackendSession>;
}

interface FleetAgentRequestRunner {
  run(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
  runBackground(options: UnifiedAgentBackgroundRequestOptions): Promise<UnifiedAgentResult>;
}

export interface AgentStreamingSink {
  onAgentStreamEvent(event: AgentStreamEvent): void | Promise<void>;
}

interface FleetAgentRuntimeHost {
  readonly requestRunner: FleetAgentRequestRunner;
}

export interface FleetAgentServices {
  run(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
  runBackground(options: UnifiedAgentBackgroundRequestOptions): Promise<UnifiedAgentResult>;
}

export function createAgentServices(agent: FleetAgentRuntimeHost): FleetAgentServices {
  return {
    run(options) {
      return agent.requestRunner.run(options);
    },
    runBackground(options) {
      return agent.requestRunner.runBackground(options);
    },
  };
}
