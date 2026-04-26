import { mkdir } from "node:fs/promises";
import path from "node:path";

import { ARCHIVE_DIRNAME, PATCH_FILENAME, PATCH_META_FILENAME } from "../constants.js";
import { enqueuePatch } from "../patch.js";
import { ensureMemoryRoot, resolveMemoryPaths } from "../paths.js";
import {
  WIKI_AAR_DESCRIPTION,
  WIKI_AAR_GUIDELINES,
  WIKI_AAR_PROMPT_SNIPPET,
  buildWikiAarSchema,
} from "../prompts.js";
import { appendLogEntry, writeJsonFile, writePatchFile } from "../store.js";
import type { LogEntry, Patch, PatchMeta } from "../types.js";

export function buildAarProposeToolConfig() {
  return {
    name: "wiki_aar_propose",
    label: "Wiki AAR Propose",
    description: WIKI_AAR_DESCRIPTION,
    promptSnippet: WIKI_AAR_PROMPT_SNIPPET,
    promptGuidelines: [...WIKI_AAR_GUIDELINES],
    parameters: buildWikiAarSchema(),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const paths = resolveMemoryPaths(ctx.cwd);
      const now = new Date().toISOString();
      const entry: LogEntry = {
        id: String(params.id),
        created: now,
        kind: String(params.kind),
        title: typeof params.title === "string" ? params.title : undefined,
        tags: Array.isArray(params.tags) ? params.tags.map(String) : undefined,
        refs: Array.isArray(params.refs) ? params.refs.map(String) : undefined,
        body: String(params.body),
      };
      const patch: Patch = {
        frontmatter: {
          op: "append_log",
          target: `log/${now.slice(0, 10)}-${entry.id}.md`,
          summary: `${entry.kind}:${entry.id}`.slice(0, 120),
          proposer: String(params.proposer ?? "tool:wiki_aar_propose"),
          created: now,
        },
        body: JSON.stringify(entry),
      };

      if (params.auto_apply === true) {
        await ensureMemoryRoot(paths);
        const relativePath = await appendLogEntry(entry, paths);
        const archiveId = `${now.replace(/[:.]/g, "-")}-${entry.id}`;
        const archiveDir = path.join(paths.archiveDir, archiveId);
        await mkdir(archiveDir, { recursive: true });
        await writePatchFile(path.join(archiveDir, PATCH_FILENAME), serializePatch(patch), paths);
        await writeJsonFile(path.join(archiveDir, PATCH_META_FILENAME), {
          id: archiveId,
          status: "accepted",
          createdAt: now,
          decidedAt: now,
        } satisfies PatchMeta, paths);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ok: true, auto_applied: true, path: relativePath, archive: `${ARCHIVE_DIRNAME}/${archiveId}` }, null, 2),
          }],
          details: {},
        };
      }

      const patchId = await enqueuePatch(patch, paths);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true, auto_applied: false, patch_id: patchId }, null, 2) }],
        details: {},
      };
    },
  };
}

function serializePatch(patch: Patch): string {
  return `---\nop: "${patch.frontmatter.op}"\ntarget: "${patch.frontmatter.target}"\nsummary: "${patch.frontmatter.summary}"\nproposer: "${patch.frontmatter.proposer}"\ncreated: "${patch.frontmatter.created}"\n---\n${patch.body}`;
}
