import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { approvePatch, enqueuePatch, parsePatch, rejectPatch, showQueue, validatePatch } from "../memory/patch.js";
import { resolveMemoryPaths } from "../memory/paths.js";
import { pathExists, readJsonFile, readPatchFile, writeWikiEntry } from "../memory/store.js";
import type { PatchMeta } from "../memory/types.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("memory patch queue", () => {
  it("supports enqueue, show, approve, and archive", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const patch = await parsePatch(`---\nop: "create_wiki"\ntarget: "wiki/alpha.md"\nsummary: "Alpha"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{"id":"alpha","title":"Alpha","tags":[],"created":"2026-04-26T00:00:00.000Z","updated":"2026-04-26T00:00:00.000Z","version":1,"body":"hello"}`);

    const patchId = await enqueuePatch(patch, paths);
    const queued = await showQueue(patchId, paths);
    const meta = await approvePatch(patchId, paths);

    expect(queued.patch.frontmatter.op).toBe("create_wiki");
    expect(meta.status).toBe("accepted");
    expect(await pathExists(path.join(paths.archiveDir, patchId))).toBe(true);
    expect(await pathExists(path.join(paths.wikiDir, "alpha.md"))).toBe(true);
  });

  it("rejects traversal targets and invalid append targets", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const traversal = await parsePatch(`---\nop: "create_wiki"\ntarget: "../../../etc/passwd"\nsummary: "Bad"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{}`);
    const badLog = await parsePatch(`---\nop: "append_log"\ntarget: "wiki/nope.md"\nsummary: "Bad log"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{}`);

    await expect(validatePatch(traversal, paths)).rejects.toThrow(/escapes memory root/);
    await expect(validatePatch(badLog, paths)).rejects.toThrow(/log/);
  });

  it("rejects update_wiki when the target is missing", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const patch = await parsePatch(`---\nop: "update_wiki"\ntarget: "wiki/missing.md"\nsummary: "Missing"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{}`);

    await expect(validatePatch(patch, paths)).rejects.toThrow(/does not exist/);
  });

  it("rejects a safe target whose body tries to escape through entry id", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const patch = await parsePatch(`---\nop: "create_wiki"\ntarget: "wiki/safe.md"\nsummary: "Safe"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{"id":"../escape","title":"Escape","tags":[],"created":"2026-04-26T00:00:00.000Z","updated":"2026-04-26T00:00:00.000Z","version":1,"body":"bad"}`);
    const patchId = await enqueuePatch(patch, paths);

    await expect(approvePatch(patchId, paths)).rejects.toThrow(/unsafe memory id/);
    expect(await pathExists(path.join(paths.wikiDir, "safe.md"))).toBe(false);
  });

  it("archives rejections without mutating wiki or log", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const patch = await parsePatch(`---\nop: "create_wiki"\ntarget: "wiki/beta.md"\nsummary: "Beta"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{"id":"beta","title":"Beta","tags":[],"created":"2026-04-26T00:00:00.000Z","updated":"2026-04-26T00:00:00.000Z","version":1,"body":"hello"}`);

    const patchId = await enqueuePatch(patch, paths);
    const meta = await rejectPatch(patchId, "nope", paths);
    const archivedMeta = await readJsonFile<PatchMeta>(path.join(paths.archiveDir, patchId, "meta.json"));

    expect(meta.status).toBe("rejected");
    expect(archivedMeta.reason).toBe("nope");
    expect(await pathExists(path.join(paths.wikiDir, "beta.md"))).toBe(false);
    expect(await pathExists(path.join(paths.logDir, "beta.md"))).toBe(false);
  });

  it("fails reject after approve because the queue entry is gone", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);

    await writeWikiEntry({
      id: "gamma",
      title: "Gamma",
      tags: [],
      created: "2026-04-26T00:00:00.000Z",
      updated: "2026-04-26T00:00:00.000Z",
      version: 1,
      body: "base",
    }, paths);

    const patch = await parsePatch(`---\nop: "update_wiki"\ntarget: "wiki/gamma.md"\nsummary: "Gamma"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{"id":"gamma","title":"Gamma","tags":[],"created":"2026-04-26T00:00:00.000Z","updated":"2026-04-26T00:00:01.000Z","version":2,"body":"updated"}`);
    const patchId = await enqueuePatch(patch, paths);
    await approvePatch(patchId, paths);

    await expect(rejectPatch(patchId, "late", paths)).rejects.toThrow();
    expect(await readPatchFile(path.join(paths.archiveDir, patchId, "patch.md"))).toContain("\"update_wiki\"");
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleet-memory-patch-"));
  cleanupPaths.push(root);
  return root;
}
