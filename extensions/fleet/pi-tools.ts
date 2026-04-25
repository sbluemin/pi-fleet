import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { CARRIER_RESULT_CUSTOM_TYPE, carrierResultRenderer } from "./shipyard/_shared/push-renderer.js";
import { configureJobSummaryCache } from "./shipyard/_shared/lru-cache.js";
import { detachJobArchive } from "./shipyard/_shared/job-stream-archive.js";
import { buildSortieToolConfig } from "./shipyard/carrier/sortie.js";
import { buildCarrierJobsToolConfig } from "./shipyard/carrier_jobs/index.js";
import { buildSquadronToolConfig } from "./shipyard/squadron/index.js";
import { buildTaskForceToolConfig } from "./shipyard/taskforce/index.js";

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
