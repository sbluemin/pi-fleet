import crypto from "crypto";

import type { AgentToolRegistry, AgentToolSpec } from "./tool-registry.js";
import {
  registerToolsForSession,
  removeToolsForSession,
  type Tool,
} from "../services/agent/tool-snapshot.js";
import {
  startMcpServer,
  stopMcpServer,
  type McpCallToolResult,
} from "../services/agent/provider-mcp.js";

export interface PendingToolCall {
  readonly token: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly createdAt: number;
}

export interface PendingToolResult {
  readonly token: string;
  readonly toolName: string;
  readonly result?: unknown;
  readonly error?: string;
}

export interface McpServerOptions {
  readonly sessionToken?: string;
  readonly now?: () => number;
}

export interface McpServerHandle {
  listTools(): readonly AgentToolSpec[];
  close(): Promise<void>;
}

export interface McpRegistryAPI {
  readonly registry: AgentToolRegistry;
  createServer(options?: McpServerOptions): McpServerHandle;
}

export function createMcpServerForRegistry(
  registry: AgentToolRegistry,
  options?: McpServerOptions,
): McpServerHandle {
  const sessionToken = options?.sessionToken ?? `registry:${crypto.randomUUID()}`;
  const snapshot = () => registerToolsForSession(sessionToken, registry.list().map(specToTool));
  snapshot();
  const unsubscribe = registry.onChange(snapshot);
  void startMcpServer();

  return {
    listTools() {
      return registry.list();
    },
    async close() {
      unsubscribe();
      removeToolsForSession(sessionToken);
      await stopMcpServer();
    },
  };
}

export type { McpCallToolResult };

function specToTool(spec: AgentToolSpec): Tool {
  return {
    name: spec.mcp?.exposeAs ?? spec.name,
    description: spec.description,
    parameters: spec.parameters,
  };
}
