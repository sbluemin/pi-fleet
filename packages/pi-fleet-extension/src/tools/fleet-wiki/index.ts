import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { briefingQuery } from "@sbluemin/fleet-wiki";
import { registerWikiCommands } from "../../commands/wiki-menu.js";
import { runDryDock } from "@sbluemin/fleet-wiki";
import { resolveMemoryPaths } from "@sbluemin/fleet-wiki";
import { buildBriefingToolConfig } from "@sbluemin/fleet-wiki";
import { buildDryDockToolConfig } from "@sbluemin/fleet-wiki";
import { buildIngestToolConfig } from "@sbluemin/fleet-wiki";
import { buildPatchQueueToolConfig } from "@sbluemin/fleet-wiki";

export type {
  BriefingHit,
  DryDockIssue,
  DryDockReport,
  WikiIndexEntry,
  MemoryPaths,
  Patch,
  PatchFrontmatter,
  PatchMeta,
  PatchOp,
  PatchStatus,
  RawSourceEntry,
  WikiEntry,
} from "@sbluemin/fleet-wiki";

export {
  briefingQuery,
  resolveMemoryPaths,
  runDryDock,
};

export function bootFleetWiki(pi: ExtensionAPI): void {
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  if (bootCfg?.experimental !== true) {
    return;
  }

  pi.registerTool(buildIngestToolConfig());
  pi.registerTool(buildBriefingToolConfig());
  pi.registerTool(buildDryDockToolConfig());
  pi.registerTool(buildPatchQueueToolConfig());
  registerWikiCommands(pi);
}

export default function registerFleetWiki(pi: ExtensionAPI): void {
  bootFleetWiki(pi);
}
