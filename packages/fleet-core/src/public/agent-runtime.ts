import type { BackendAdapter } from "./backend-adapter.js";
import type { FleetHostPorts } from "./host-ports.js";
import { createAgentRequestService } from "./agent-request.js";
import type { AgentRequestService } from "./agent-request.js";
import { createMcpServerForRegistry, type McpRegistryAPI, type McpServerHandle } from "./mcp.js";
import { createAgentToolRegistry, type AgentToolRegistry } from "./tool-registry.js";

export interface AgentRuntimeOptions {
  readonly dataDir: string;
  readonly ports: FleetHostPorts;
  readonly backend?: BackendAdapter;
  readonly toolRegistry?: AgentToolRegistry;
}

export interface AgentRuntime {
  readonly toolRegistry: AgentToolRegistry;
  readonly mcp: McpRegistryAPI;
  readonly agentRequest: AgentRequestService;
  shutdown(): Promise<void>;
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const toolRegistry = options.toolRegistry ?? createAgentToolRegistry();
  const serverHandles = new Set<McpServerHandle>();
  const mcp: McpRegistryAPI = {
    registry: toolRegistry,
    createServer(serverOptions) {
      const handle = createMcpServerForRegistry(toolRegistry, serverOptions);
      serverHandles.add(handle);
      return {
        listTools() {
          return handle.listTools();
        },
        async close() {
          serverHandles.delete(handle);
          await handle.close();
        },
      };
    },
  };
  const agentRequest = createAgentRequestService({
    streamingSink: options.ports.streamingSink,
  });

  return {
    toolRegistry,
    mcp,
    agentRequest,
    async shutdown() {
      const handles = [...serverHandles];
      serverHandles.clear();
      await Promise.all(handles.map((handle) => handle.close()));
    },
  };
}
