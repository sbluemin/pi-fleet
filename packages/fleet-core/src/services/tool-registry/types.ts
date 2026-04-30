export type FleetLogLevel = "debug" | "info" | "warn" | "error";

export interface CompletionPushPayload {
  readonly jobId: string;
  readonly carrierId: string;
  readonly title: string;
  readonly content: string;
  readonly details?: unknown;
}

export interface FleetToolRegistryHostPorts {
  sendCarrierResultPush(payload: CompletionPushPayload): void | Promise<void>;
  notify(level: FleetLogLevel, message: string): void | Promise<void>;
  loadSetting<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  saveSetting<T = unknown>(key: string, value: T): void | Promise<void>;
  registerKeybind(binding: unknown): (() => void) | Promise<() => void>;
  now(): number;
  getDeliverAs(): string | undefined;
}

export interface TypeBoxSchema {
  readonly [key: string]: unknown;
}

export interface AgentToolCtx {
  readonly cwd: string;
  readonly toolCallId?: string;
  readonly signal?: AbortSignal;
  readonly now: () => number;
  readonly ports: FleetToolRegistryHostPorts;
}

export interface AgentToolRenderDescriptor {
  call?(args: unknown, ctx: AgentToolCtx): unknown;
  result?(result: unknown, ctx: AgentToolCtx): unknown;
}

export interface AgentToolPiDescriptor {
  readonly messageRenderer?: unknown;
  readonly cacheConfig?: unknown;
}

export interface AgentToolMcpDescriptor {
  readonly exposeAs?: string;
  redact?(value: unknown): unknown;
}

export interface AgentToolSpec {
  readonly name: string;
  readonly label?: string;
  readonly description: string;
  readonly promptSnippet?: string;
  readonly promptGuidelines?: readonly string[];
  readonly parameters: TypeBoxSchema;
  execute(args: unknown, ctx: AgentToolCtx): Promise<unknown>;
  readonly render?: AgentToolRenderDescriptor;
  readonly pi?: AgentToolPiDescriptor;
  readonly mcp?: AgentToolMcpDescriptor;
}

export interface ToolPromptManifest {
  id: string;
  tag: string;
  title: string;
  description: string;
  promptSnippet: string;
  whenToUse: string[];
  whenNotToUse: string[];
  usageGuidelines: string[];
  guardrails?: string[];
}
