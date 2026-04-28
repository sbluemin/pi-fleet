import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { briefingQuery } from "./briefing.js";
import { registerWikiCommands } from "./commands.js";
import { runDryDock } from "./drydock.js";
import { resolveMemoryPaths } from "./paths.js";
import { buildAarProposeToolConfig } from "./tools/aar.js";
import { buildBriefingToolConfig } from "./tools/briefing.js";
import { buildDryDockToolConfig } from "./tools/drydock.js";
import { buildIngestToolConfig } from "./tools/ingest.js";
import { buildPatchQueueToolConfig } from "./tools/patch-queue.js";

export type {
  BriefingHit,
  DryDockIssue,
  DryDockReport,
  LogEntry,
  WikiIndexEntry,
  MemoryPaths,
  Patch,
  PatchFrontmatter,
  PatchMeta,
  PatchOp,
  PatchStatus,
  RawSourceEntry,
  WikiEntry,
} from "./types.js";

export {
  briefingQuery,
  resolveMemoryPaths,
  runDryDock,
};

export function bootExperimentalWiki(pi: ExtensionAPI): void {
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  if (bootCfg?.experimental !== true) {
    return;
  }

  pi.registerTool(buildIngestToolConfig());
  pi.registerTool(buildBriefingToolConfig());
  pi.registerTool(buildAarProposeToolConfig());
  pi.registerTool(buildDryDockToolConfig());
  pi.registerTool(buildPatchQueueToolConfig());
  registerWikiCommands(pi);
}

export default function registerExperimentalWiki(pi: ExtensionAPI): void {
  bootExperimentalWiki(pi);
}
