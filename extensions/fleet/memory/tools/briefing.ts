import { registerToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import { briefingQuery } from "../briefing.js";
import { resolveMemoryPaths } from "../paths.js";
import {
  MEMORY_BRIEFING_DESCRIPTION,
  MEMORY_BRIEFING_MANIFEST,
  buildMemoryBriefingSchema,
} from "../prompts.js";

export function buildBriefingToolConfig() {
  registerToolPromptManifest(MEMORY_BRIEFING_MANIFEST);

  return {
    name: "memory_briefing",
    label: "Memory Briefing",
    description: MEMORY_BRIEFING_DESCRIPTION,
    promptSnippet: MEMORY_BRIEFING_MANIFEST.promptSnippet,
    promptGuidelines: [...MEMORY_BRIEFING_MANIFEST.usageGuidelines],
    parameters: buildMemoryBriefingSchema(),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const hits = await briefingQuery(resolveMemoryPaths(ctx.cwd), {
        topic: typeof params.topic === "string" ? params.topic : undefined,
        tags: Array.isArray(params.tags) ? params.tags.map(String) : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined,
      });
      const text = JSON.stringify({ ok: true, hits }, null, 2).slice(0, 50_000);
      return {
        content: [{ type: "text" as const, text }],
        details: {},
      };
    },
  };
}
