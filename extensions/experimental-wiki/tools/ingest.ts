import { enqueuePatch } from "../patch.js";
import { resolveMemoryPaths } from "../paths.js";
import {
  WIKI_INGEST_DESCRIPTION,
  WIKI_INGEST_GUIDELINES,
  WIKI_INGEST_PROMPT_SNIPPET,
  buildWikiIngestSchema,
} from "../prompts.js";
import { assertNoUnsafeSecret, findUnsafeMemoryText } from "../safety.js";
import { writeRawSourceEntry } from "../store.js";
import type { Patch, RawSourceEntry, WikiEntry } from "../types.js";

export function buildIngestToolConfig() {
  return {
    name: "wiki_ingest",
    label: "Wiki Ingest",
    description: WIKI_INGEST_DESCRIPTION,
    promptSnippet: WIKI_INGEST_PROMPT_SNIPPET,
    promptGuidelines: [...WIKI_INGEST_GUIDELINES],
    parameters: buildWikiIngestSchema(),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const now = new Date().toISOString();
      const paths = resolveMemoryPaths(ctx.cwd);
      const sourceContent = String(params.source);
      assertNoUnsafeSecret(sourceContent);
      const warnings = findUnsafeMemoryText(sourceContent)
        .filter((issue) => issue.severity === "warning")
        .map((issue) => issue.message);
      const rawSource: RawSourceEntry = {
        id: `${String(params.id)}-source`,
        created: now,
        sourceType: params.source_type === "file" ? "file" : "inline",
        title: typeof params.source_title === "string" ? params.source_title : String(params.title),
        tags: Array.isArray(params.tags) ? params.tags.map(String) : [],
        content: sourceContent,
      };
      const rawSourceRef = await writeRawSourceEntry(rawSource, paths);

      const entry: WikiEntry = {
        id: String(params.id),
        title: String(params.title),
        body: `${String(params.body)}\n\nraw_source_ref: ${rawSourceRef}`,
        tags: Array.isArray(params.tags) ? params.tags.map(String) : [],
        created: now,
        updated: now,
        version: 1,
      };
      const patch: Patch = {
        frontmatter: {
          op: "create_wiki",
          target: `wiki/${entry.id}.md`,
          summary: `${entry.title}`.slice(0, 120),
          proposer: String(params.proposer ?? "tool:wiki_ingest"),
          created: now,
        },
        body: JSON.stringify(entry),
      };
      const patchId = await enqueuePatch(patch, paths, { rawSourceRef, warnings });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ok: true, patch_id: patchId, raw_source_ref: rawSourceRef, warnings }, null, 2),
        }],
        details: { raw_source_ref: rawSourceRef },
      };
    },
  };
}
