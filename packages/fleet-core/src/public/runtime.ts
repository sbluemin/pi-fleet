import { initRuntime } from "../agent/runtime.js";
import { initServiceStatus, resetServiceStatus } from "../agent/service-status/store.js";
import { initStore } from "../store/fleet-store.js";
import { createAgentRuntime, type AgentRuntime } from "./agent-runtime.js";
import type { AgentRequestService } from "./agent-request.js";
import type { BackendAdapter } from "./backend-adapter.js";
import type { FleetHostPorts } from "./host-ports.js";
import type { McpRegistryAPI } from "./mcp.js";
import type { AgentToolRegistry } from "./tool-registry.js";

export interface JobServices {
  readonly [key: string]: unknown;
}

export interface CarrierServices {
  readonly [key: string]: unknown;
}

export interface AdmiralServices {
  readonly [key: string]: unknown;
}

export interface MetaphorServices {
  readonly [key: string]: unknown;
}

export interface GrandFleetServices {
  readonly [key: string]: unknown;
}

export interface FleetCoreRuntimeOptions {
  readonly dataDir: string;
  readonly ports: FleetHostPorts;
  readonly backend?: BackendAdapter;
}

export interface FleetCoreRuntime {
  readonly agent: AgentRuntime;
  readonly agentRequest: AgentRequestService;
  readonly jobs: JobServices;
  readonly carriers: CarrierServices;
  readonly admiral: AdmiralServices;
  readonly metaphor: MetaphorServices;
  readonly experimentalWiki?: unknown;
  readonly grandFleet?: GrandFleetServices;
  readonly toolRegistry: AgentToolRegistry;
  readonly mcp: McpRegistryAPI;
  shutdown(): Promise<void>;
}

export function createFleetCoreRuntime(options: FleetCoreRuntimeOptions): FleetCoreRuntime {
  initRuntime(options.dataDir);
  initStore(options.dataDir);
  const agent = createAgentRuntime(options);
  if (options.ports.serviceStatus) {
    initServiceStatus(options.ports.serviceStatus);
  } else {
    resetServiceStatus();
  }

  return {
    agent,
    agentRequest: agent.agentRequest,
    jobs: {},
    carriers: {},
    admiral: {},
    metaphor: {},
    toolRegistry: agent.toolRegistry,
    mcp: agent.mcp,
    async shutdown() {
      await agent.shutdown();
      resetServiceStatus();
    },
  };
}
