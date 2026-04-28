import crypto from "crypto";

import type { FleetHostPorts, FleetLogPort } from "./host-ports.js";
import {
  clearAllTools,
  computeToolHash,
  convertToolSchema,
  getToolNamesForSession,
  getToolsForSession,
  registerToolsForSession,
  removeToolsForSession,
  type Tool,
} from "../agent/tool-snapshot.js";

export interface TypeBoxSchema {
  readonly [key: string]: unknown;
}

export interface AgentToolCtx {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly log: FleetLogPort;
  readonly now: () => number;
  readonly ports: FleetHostPorts;
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
  readonly description: string;
  readonly parameters: TypeBoxSchema;
  execute(args: unknown, ctx: AgentToolCtx): Promise<unknown>;
  readonly render?: AgentToolRenderDescriptor;
  readonly pi?: AgentToolPiDescriptor;
  readonly mcp?: AgentToolMcpDescriptor;
}

export interface AgentToolRegistry {
  register(spec: AgentToolSpec): void;
  unregister(name: string): void;
  list(): readonly AgentToolSpec[];
  get(name: string): AgentToolSpec | undefined;
  onChange(listener: () => void): () => void;
  computeHash(): string;
}

export function createAgentToolRegistry(): AgentToolRegistry {
  const sessionToken = `registry:${crypto.randomUUID()}`;
  const specs = new Map<string, AgentToolSpec>();
  const listeners = new Set<() => void>();

  const snapshot = () => {
    registerToolsForSession(sessionToken, [...specs.values()].map(specToTool));
    for (const listener of listeners) listener();
  };

  return {
    register(spec) {
      specs.set(spec.name, spec);
      snapshot();
    },
    unregister(name) {
      specs.delete(name);
      snapshot();
    },
    list() {
      return [...specs.values()];
    },
    get(name) {
      return specs.get(name);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    computeHash() {
      return computeToolHash([...specs.values()].map(specToTool));
    },
  };
}

export {
  clearAllTools,
  computeToolHash,
  convertToolSchema,
  getToolNamesForSession,
  getToolsForSession,
  registerToolsForSession,
  removeToolsForSession,
};

function specToTool(spec: AgentToolSpec): Tool {
  return {
    name: spec.mcp?.exposeAs ?? spec.name,
    description: spec.description,
    parameters: spec.parameters,
  };
}
