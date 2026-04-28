import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { CARRIER_RESULT_CUSTOM_TYPE, carrierResultRenderer } from "./carrier-result-renderer.js";
import { configureJobSummaryCache } from "@sbluemin/fleet-core/job";
import { detachJobArchive } from "@sbluemin/fleet-core/job";
import { buildSortieToolConfig } from "./carrier/sortie.js";
import { buildCarrierJobsToolConfig } from "./carrier_jobs/index.js";
import { buildSquadronToolConfig } from "./squadron/index.js";
import { buildTaskForceToolConfig } from "./taskforce/index.js";

export function registerFleetPiTools(pi: ExtensionAPI): void {
  const sortieToolConfig = buildSortieToolConfig(pi);
  if (sortieToolConfig) pi.registerTool(sortieToolConfig);

  const taskForceToolConfig = buildTaskForceToolConfig(pi);
  if (taskForceToolConfig) pi.registerTool(taskForceToolConfig);

  const squadronToolConfig = buildSquadronToolConfig(pi);
  if (squadronToolConfig) pi.registerTool(squadronToolConfig);

  configureJobSummaryCache(50, detachJobArchive);
  pi.registerMessageRenderer(CARRIER_RESULT_CUSTOM_TYPE, carrierResultRenderer);
  pi.registerTool(buildCarrierJobsToolConfig());
}
