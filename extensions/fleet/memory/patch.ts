import { mkdir } from "node:fs/promises";
import path from "node:path";

import { PATCH_FILENAME, PATCH_META_FILENAME } from "./constants.js";
import { ensureMemoryRoot } from "./paths.js";
import {
  appendLogEntry,
  listDirectoryNames,
  movePath,
  pathExists,
  readJsonFile,
  readPatchFile,
  rebuildIndex,
  removePath,
  writeJsonFile,
  writePatchFile,
  writeWikiEntry,
} from "./store.js";
import type { LogEntry, MemoryPaths, Patch, PatchMeta, WikiEntry } from "./types.js";

export async function parsePatch(markdown: string): Promise<Patch> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("missing patch frontmatter");
  const [, rawFrontmatter, body] = match;
  const frontmatter: Record<string, string> = {};
  for (const line of rawFrontmatter.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator === -1) throw new Error(`invalid patch frontmatter line: ${line}`);
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return {
    frontmatter: {
      op: frontmatter.op as Patch["frontmatter"]["op"],
      target: frontmatter.target ?? "",
      summary: frontmatter.summary ?? "",
      proposer: frontmatter.proposer ?? "",
      created: frontmatter.created ?? "",
    },
    body,
  };
}

export async function validatePatch(patch: Patch, paths: MemoryPaths): Promise<void> {
  const { op, target, summary, proposer, created } = patch.frontmatter;
  if (!["create_wiki", "update_wiki", "append_log"].includes(op)) throw new Error("invalid patch op");
  if (!target || !summary || !proposer || !created) throw new Error("patch frontmatter is incomplete");
  if (summary.length > 120) throw new Error("patch summary exceeds 120 chars");

  const absoluteTarget = path.resolve(paths.root, target);
  if (!absoluteTarget.startsWith(`${paths.root}${path.sep}`) && absoluteTarget !== paths.root) {
    throw new Error("patch target escapes memory root");
  }

  if (op === "append_log") {
    if (!absoluteTarget.startsWith(`${paths.logDir}${path.sep}`)) throw new Error("append_log must target log/");
    return;
  }

  if (!absoluteTarget.startsWith(`${paths.wikiDir}${path.sep}`)) throw new Error("wiki patch must target wiki/");
  if (op === "update_wiki" && !(await pathExists(absoluteTarget))) throw new Error("update_wiki target does not exist");
}

export async function applyPatch(patch: Patch, paths: MemoryPaths): Promise<string> {
  await validatePatch(patch, paths);

  if (patch.frontmatter.op === "append_log") {
    const entry = JSON.parse(patch.body) as LogEntry;
    const relativePath = await appendLogEntry(entry, paths);
    await rebuildIndex(paths);
    return relativePath;
  }

  const entry = JSON.parse(patch.body) as WikiEntry;
  const relativePath = await writeWikiEntry(entry, paths);
  await rebuildIndex(paths);
  return relativePath;
}

export async function enqueuePatch(patch: Patch, paths: MemoryPaths, metaOverrides?: Partial<PatchMeta>): Promise<string> {
  await ensureMemoryRoot(paths);
  const patchId = buildPatchId(patch.frontmatter.created, patch.frontmatter.summary);
  const queueDir = path.join(paths.queueDir, patchId);
  await mkdir(queueDir, { recursive: true });
  await writePatchFile(path.join(queueDir, PATCH_FILENAME), serializePatch(patch), paths);
  await writeJsonFile(path.join(queueDir, PATCH_META_FILENAME), {
    id: patchId,
    status: "pending",
    createdAt: patch.frontmatter.created,
    ...metaOverrides,
  } satisfies PatchMeta, paths);
  return patchId;
}

export async function listQueue(paths: MemoryPaths): Promise<Array<{ id: string; meta: PatchMeta }>> {
  const ids = await listDirectoryNames(paths.queueDir);
  const results: Array<{ id: string; meta: PatchMeta }> = [];
  for (const id of ids) {
    const meta = await readJsonFile<PatchMeta>(path.join(paths.queueDir, id, PATCH_META_FILENAME));
    results.push({ id, meta });
  }
  return results;
}

export async function showQueue(id: string, paths: MemoryPaths): Promise<{ patch: Patch; meta: PatchMeta }> {
  const queueDir = path.join(paths.queueDir, id);
  const patch = await parsePatch(await readPatchFile(path.join(queueDir, PATCH_FILENAME)));
  const meta = await readJsonFile<PatchMeta>(path.join(queueDir, PATCH_META_FILENAME));
  return { patch, meta };
}

export async function approvePatch(id: string, paths: MemoryPaths): Promise<PatchMeta> {
  const { patch, meta } = await showQueue(id, paths);
  if (meta.status !== "pending") throw new Error("patch is not pending");
  await applyPatch(patch, paths);
  const nextMeta: PatchMeta = {
    ...meta,
    status: "accepted",
    decidedAt: new Date().toISOString(),
  };
  await archiveQueueEntry(id, paths, nextMeta);
  return nextMeta;
}

export async function rejectPatch(id: string, reason: string, paths: MemoryPaths): Promise<PatchMeta> {
  const { meta } = await showQueue(id, paths);
  if (meta.status !== "pending") throw new Error("patch is not pending");
  const nextMeta: PatchMeta = {
    ...meta,
    status: "rejected",
    decidedAt: new Date().toISOString(),
    reason,
  };
  await archiveQueueEntry(id, paths, nextMeta);
  return nextMeta;
}

function serializePatch(patch: Patch): string {
  const lines = [
    `op: "${patch.frontmatter.op}"`,
    `target: "${patch.frontmatter.target}"`,
    `summary: "${patch.frontmatter.summary}"`,
    `proposer: "${patch.frontmatter.proposer}"`,
    `created: "${patch.frontmatter.created}"`,
  ];
  return `---\n${lines.join("\n")}\n---\n${patch.body}`;
}

function buildPatchId(createdAt: string, summary: string): string {
  const compact = createdAt.replace(/[:.]/g, "-");
  const hash = Buffer.from(summary).toString("hex").slice(0, 8) || "00000000";
  return `${compact}-${hash}`;
}

async function archiveQueueEntry(id: string, paths: MemoryPaths, meta: PatchMeta): Promise<void> {
  const fromDir = path.join(paths.queueDir, id);
  const toDir = path.join(paths.archiveDir, id);
  await removePath(toDir);
  await movePath(fromDir, toDir);
  await writeJsonFile(path.join(toDir, PATCH_META_FILENAME), meta, paths);
}
