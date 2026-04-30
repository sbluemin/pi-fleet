import crypto from "crypto";

import type { FleetHostPorts, FleetLogPort } from "./host-ports.js";
import { buildSortieToolSpec } from "../admiral/carrier/tool-spec.js";
import { buildSquadronToolSpec } from "../admiral/squadron/tool-spec.js";
import { buildTaskForceToolSpec } from "../admiral/taskforce/tool-spec.js";
import {
  clearAllTools,
  computeToolHash,
  convertToolSchema,
  getToolNamesForSession,
  getToolsForSession,
  registerToolsForSession,
  removeToolsForSession,
  type Tool,
} from "../services/agent/tool-snapshot.js";
import {
  CARRIER_JOBS_DESCRIPTION,
  CARRIER_JOBS_MANIFEST,
  buildCarrierJobsPromptGuidelines,
  buildCarrierJobsPromptSnippet,
  buildCarrierJobsSchema,
  dispatchCarrierJobsAction,
  type CarrierJobsParams,
} from "../admiral/carrier-jobs/index.js";
import { registerToolPromptManifest } from "../services/tool-registry/index.js";

export interface TypeBoxSchema {
  readonly [key: string]: unknown;
}

export interface AgentToolCtx {
  readonly cwd: string;
  readonly toolCallId?: string;
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

export interface AgentToolRegistry {
  register(spec: AgentToolSpec): void;
  unregister(name: string): void;
  list(): readonly AgentToolSpec[];
  get(name: string): AgentToolSpec | undefined;
  onChange(listener: () => void): () => void;
  computeHash(): string;
}

export interface FleetToolRegistryPorts {
  readonly logDebug: (category: string, message: string, options?: unknown) => void;
  readonly runAgentRequestBackground: (options: any) => Promise<any>;
  readonly enqueueCarrierCompletionPush: (payload: { jobId: string; summary: string }) => void;
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

export function createFleetToolRegistry(ports: FleetToolRegistryPorts): readonly AgentToolSpec[] {
  const specs: AgentToolSpec[] = [];
  const sortie = buildSortieToolSpec(ports);
  const taskForce = buildTaskForceToolSpec(ports);
  const squadron = buildSquadronToolSpec(ports);

  if (sortie) specs.push(sortie);
  if (taskForce) specs.push(taskForce);
  if (squadron) specs.push(squadron);
  specs.push(buildCarrierJobsToolSpec());

  return specs;
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

function buildCarrierJobsToolSpec(): AgentToolSpec {
  registerToolPromptManifest(CARRIER_JOBS_MANIFEST);

  return {
    name: "carrier_jobs",
    label: "Carrier Jobs",
    description: CARRIER_JOBS_DESCRIPTION,
    promptSnippet: buildCarrierJobsPromptSnippet(),
    promptGuidelines: buildCarrierJobsPromptGuidelines(),
    parameters: buildCarrierJobsSchema(),
    async execute(args: unknown) {
      const result = dispatchCarrierJobsAction(args as CarrierJobsParams);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
