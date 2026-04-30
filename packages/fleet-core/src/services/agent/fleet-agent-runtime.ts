import { createAgentRequestService } from "./request/service.js";
import type {
  FleetHostPorts,
  UnifiedAgentBackgroundRequestOptions,
  UnifiedAgentRequestOptions,
  UnifiedAgentResult,
} from "../../public/agent-services.js";
import {
  createMcpServerForRegistry,
  createAgentToolRegistry,
  type AgentToolRegistry,
  type McpRegistryAPI,
  type McpServerHandle,
} from "../../public/tool-registry-services.js";

interface AgentRequestService {
  run(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
  runBackground(options: UnifiedAgentBackgroundRequestOptions): Promise<UnifiedAgentResult>;
}

export interface AgentRuntimeOptions {
  readonly dataDir: string;
  readonly ports: FleetHostPorts;
  readonly toolRegistry?: AgentToolRegistry;
}

export interface FleetAgentRuntime {
  readonly toolRegistry: AgentToolRegistry;
  readonly mcp: McpRegistryAPI;
  readonly requestRunner: AgentRequestService;
  shutdown(): Promise<void>;
}

export function createAgentRuntime(options: AgentRuntimeOptions): FleetAgentRuntime {
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
  const requestRunner = createAgentRequestService({
    streamingSink: options.ports.streamingSink,
  });

  return {
    toolRegistry,
    mcp,
    requestRunner,
    async shutdown() {
      const handles = [...serverHandles];
      serverHandles.clear();
      await Promise.all(handles.map((handle) => handle.close()));
    },
  };
}
