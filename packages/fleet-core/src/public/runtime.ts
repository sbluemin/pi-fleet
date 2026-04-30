import { initStore } from "../admiral/store/fleet-store.js";
import { initRuntime } from "../services/agent/dispatcher/runtime.js";
import {
  initServiceStatus,
  resetServiceStatus,
} from "../services/agent/shared/service-status/store.js";
import { createAgentRequestService } from "../services/agent/dispatcher/request/service.js";
import {
  initSettingsService,
  resetSettingsService,
} from "../services/settings/runtime.js";
import { SettingsService } from "../services/settings/service.js";
import {
  createAgentServices,
  type FleetAgentServices,
  type FleetHostPorts,
  type UnifiedAgentBackgroundRequestOptions,
  type UnifiedAgentRequestOptions,
  type UnifiedAgentResult,
} from "./agent-services.js";
import {
  createFleetServices,
  type FleetServices,
} from "./fleet-services.js";
import {
  createGrandFleetServices,
  type GrandFleetServices,
} from "./grand-fleet-services.js";
import {
  createJobServices,
  type FleetJobServices,
} from "./job-services.js";
import {
  createLogServices,
  type FleetLogServices,
} from "./log-services.js";
import {
  createMetaphorServices,
  type FleetMetaphorServices,
} from "./metaphor-services.js";
import {
  createSettingsServices,
  type FleetSettingsServices,
} from "./settings-services.js";
import {
  createToolRegistryServices,
  createAgentToolRegistry,
  createMcpServerForRegistry,
  type AgentToolRegistry,
  type FleetToolRegistryServices,
  type McpRegistryAPI,
  type McpServerHandle,
} from "./tool-registry-services.js";

export type { FleetAgentServices } from "./agent-services.js";
export type { FleetServices } from "./fleet-services.js";
export type { GrandFleetServices } from "./grand-fleet-services.js";
export type { FleetHostPorts } from "./agent-services.js";
export type { FleetJobServices } from "./job-services.js";
export type { FleetLogServices } from "./log-services.js";
export type { FleetMetaphorServices } from "./metaphor-services.js";
export type { FleetSettingsServices } from "./settings-services.js";
export type { FleetToolRegistryServices } from "./tool-registry-services.js";

interface AgentRequestService {
  run(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
  runBackground(options: UnifiedAgentBackgroundRequestOptions): Promise<UnifiedAgentResult>;
}

interface FleetAgentRuntime {
  readonly toolRegistry: AgentToolRegistry;
  readonly mcp: McpRegistryAPI;
  readonly requestRunner: AgentRequestService;
  shutdown(): Promise<void>;
}

export interface FleetCoreRuntimeOptions {
  readonly dataDir: string;
  readonly ports: FleetHostPorts;
}

export interface FleetCoreRuntimeContext {
  readonly fleet: FleetServices;
  readonly grandFleet: GrandFleetServices;
  readonly metaphor: FleetMetaphorServices;
  readonly agent: FleetAgentServices;
  readonly jobs: FleetJobServices;
  readonly log: FleetLogServices;
  readonly settings: FleetSettingsServices;
  readonly toolRegistry: FleetToolRegistryServices;
  shutdown(): Promise<void>;
}

export function createFleetCoreRuntime(
  options: FleetCoreRuntimeOptions,
): FleetCoreRuntimeContext {
  initRuntime(options.dataDir);
  initStore(options.dataDir);
  const settings = new SettingsService();
  initSettingsService(settings);

  let agentRuntime: ReturnType<typeof createAgentRuntime>;
  try {
    agentRuntime = createAgentRuntime(options);
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
    fleet: createFleetServices(),
    grandFleet: createGrandFleetServices(),
    metaphor: createMetaphorServices(),
    agent: createAgentServices(agentRuntime),
    jobs: createJobServices(),
    log: createLogServices(),
    settings: createSettingsServices(settings),
    toolRegistry: createToolRegistryServices(agentRuntime.toolRegistry),
    async shutdown() {
      await agentRuntime.shutdown();
      resetSettingsService(settings);
      resetServiceStatus();
    },
  };
}

function createAgentRuntime(options: FleetCoreRuntimeOptions): FleetAgentRuntime {
  const toolRegistry = createAgentToolRegistry();
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
