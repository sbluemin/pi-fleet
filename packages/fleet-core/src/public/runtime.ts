import { initRuntime } from "../services/agent/runtime.js";
import { initServiceStatus, resetServiceStatus } from "../services/agent/service-status/store.js";
import type { CoreSettingsAPI } from "../services/settings/index.js";
import { initSettingsService, resetSettingsService } from "../services/settings/runtime.js";
import { SettingsService } from "../services/settings/service.js";
import { initStore } from "../admiral/store/fleet-store.js";
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

export interface CoreServices {
  readonly settings: CoreSettingsAPI;
}

export interface FleetCoreRuntimeOptions {
  readonly dataDir: string;
  readonly ports: FleetHostPorts;
  readonly backend?: BackendAdapter;
}

export interface FleetCoreRuntime {
  readonly agent: AgentRuntime;
  readonly coreServices: CoreServices;
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
  const settings = new SettingsService();
  initSettingsService(settings);
  let agent: AgentRuntime;
  try {
    agent = createAgentRuntime(options);
  } catch (error) {
    resetSettingsService(settings);
    throw error;
  }
  if (options.ports.serviceStatus) {
    initServiceStatus(options.ports.serviceStatus);
  } else {
    resetServiceStatus();
  }

  return {
    agent,
    coreServices: { settings },
    agentRequest: agent.agentRequest,
    jobs: {},
    carriers: {},
    admiral: {},
    metaphor: {},
    toolRegistry: agent.toolRegistry,
    mcp: agent.mcp,
    async shutdown() {
      await agent.shutdown();
      resetSettingsService(settings);
      resetServiceStatus();
    },
  };
}
