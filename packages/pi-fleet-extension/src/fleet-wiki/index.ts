import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { buildBriefingToolConfig } from "@sbluemin/fleet-wiki";
import { buildDryDockToolConfig } from "@sbluemin/fleet-wiki";
import { buildIngestToolConfig } from "@sbluemin/fleet-wiki";
import { buildPatchQueueToolConfig } from "@sbluemin/fleet-wiki";

import { getBootConfig } from "../fleet.js";
import { openWikiHub } from "./ui.js";

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

type FleetWikiRegistrationContext = ExtensionContext & Pick<ExtensionAPI, "registerCommand" | "registerTool">;

export function registerFleetWiki(ctx: ExtensionAPI | ExtensionContext): void {
  const pi = ctx as FleetWikiRegistrationContext;
  const bootCfg = getBootConfig();
  if (bootCfg?.experimental !== true) {
    return;
  }

  pi.registerTool(buildIngestToolConfig());
  pi.registerTool(buildBriefingToolConfig());
  pi.registerTool(buildDryDockToolConfig());
  pi.registerTool(buildPatchQueueToolConfig());
  registerWikiCommands(pi);
}

export function registerWikiCommands(pi: Pick<ExtensionAPI, "registerCommand">): void {
  pi.registerCommand("fleet:wiki:menu", {
    description: "Fleet Wiki 인터랙티브 허브",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      await openWikiHub(pi as ExtensionAPI, ctx);
    },
  });
}

export default registerFleetWiki;
