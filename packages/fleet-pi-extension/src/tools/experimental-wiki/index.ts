import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { briefingQuery } from "@sbluemin/fleet-core/experimental-wiki";
import { registerWikiCommands } from "../../commands/wiki-menu.js";
import { runDryDock } from "@sbluemin/fleet-core/experimental-wiki";
import { resolveMemoryPaths } from "@sbluemin/fleet-core/experimental-wiki";
import { buildAarProposeToolConfig } from "@sbluemin/fleet-core/experimental-wiki";
import { buildBriefingToolConfig } from "@sbluemin/fleet-core/experimental-wiki";
import { buildDryDockToolConfig } from "@sbluemin/fleet-core/experimental-wiki";
import { buildIngestToolConfig } from "@sbluemin/fleet-core/experimental-wiki";
import { buildPatchQueueToolConfig } from "@sbluemin/fleet-core/experimental-wiki";

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
} from "@sbluemin/fleet-core/experimental-wiki";

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
