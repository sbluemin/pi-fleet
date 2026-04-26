import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { briefingQuery } from "./briefing.js";
import { registerMemoryCommands } from "./commands.js";
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
  MemoryIndexEntry,
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

export function bootFleetMemory(pi: ExtensionAPI): void {
  pi.registerTool(buildIngestToolConfig());
  pi.registerTool(buildBriefingToolConfig());
  pi.registerTool(buildAarProposeToolConfig());
  pi.registerTool(buildDryDockToolConfig());
  pi.registerTool(buildPatchQueueToolConfig());
  registerMemoryCommands(pi);
}
