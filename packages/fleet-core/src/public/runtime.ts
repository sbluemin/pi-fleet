import { createAgentRuntime, type AgentRuntime } from "./agent-runtime.js";
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

export interface ExperimentalWikiServices {
  readonly [key: string]: unknown;
}

export interface GrandFleetServices {
  readonly [key: string]: unknown;
}

export interface FleetCoreRuntimeOptions {
  readonly dataDir: string;
  readonly ports: FleetHostPorts;
  readonly backend: BackendAdapter;
}

export interface FleetCoreRuntime {
  readonly agent: AgentRuntime;
  readonly jobs: JobServices;
  readonly carriers: CarrierServices;
  readonly admiral: AdmiralServices;
  readonly metaphor: MetaphorServices;
  readonly experimentalWiki?: ExperimentalWikiServices;
  readonly grandFleet?: GrandFleetServices;
  readonly toolRegistry: AgentToolRegistry;
  readonly mcp: McpRegistryAPI;
  shutdown(): Promise<void>;
}

export function createFleetCoreRuntime(options: FleetCoreRuntimeOptions): FleetCoreRuntime {
  const agent = createAgentRuntime(options);

  return {
    agent,
    jobs: {},
    carriers: {},
    admiral: {},
    metaphor: {},
    toolRegistry: agent.toolRegistry,
    mcp: agent.mcp,
    async shutdown() {
      await agent.shutdown();
    },
  };
}
