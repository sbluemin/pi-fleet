import { buildSortieToolSpec } from "../carrier/tool-spec.js";
import { dispatchCarrierJobsAction, type CarrierJobsParams } from "../carrier-jobs/index.js";
import {
  CARRIER_JOBS_DESCRIPTION,
  CARRIER_JOBS_MANIFEST,
  buildCarrierJobsPromptGuidelines,
  buildCarrierJobsPromptSnippet,
  buildCarrierJobsSchema,
} from "../carrier-jobs/index.js";
import { registerToolPromptManifest } from "../admiral/tool-prompt-manifest/index.js";
import { buildSquadronToolSpec } from "../squadron/tool-spec.js";
import { buildTaskForceToolSpec } from "../taskforce/tool-spec.js";
import type { AgentToolSpec } from "./tool-registry.js";

export interface FleetToolRegistryPorts {
  readonly logDebug: (category: string, message: string, options?: unknown) => void;
  readonly runAgentRequestBackground: (options: any) => Promise<any>;
  readonly enqueueCarrierCompletionPush: (payload: { jobId: string; summary: string }) => void;
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
