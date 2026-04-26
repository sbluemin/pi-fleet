import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveMemoryPaths } from "../memory/paths.js";
import { appendLogEntry, listLog, loadIndex, readPatchFile, readWikiEntry, rebuildIndex, writeRawSourceEntry, writeWikiEntry } from "../memory/store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("memory store", () => {
  it("round-trips wiki and log entries and rebuilds the index", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);

    await writeWikiEntry({
      id: "alpha",
      title: "Alpha",
      tags: ["one"],
      created: "2026-04-26T00:00:00.000Z",
      updated: "2026-04-26T00:00:00.000Z",
      version: 1,
      body: "hello world",
    }, paths);

    await appendLogEntry({
      id: "aar-1",
      created: "2026-04-26T00:00:00.000Z",
      kind: "aar",
      refs: ["alpha"],
      body: "after action",
    }, paths);

    await rebuildIndex(paths);

    const wiki = await readWikiEntry("alpha", paths);
    const log = await listLog(paths);
    const index = await loadIndex(paths);

    expect(wiki?.title).toBe("Alpha");
    expect(log).toHaveLength(1);
    expect(index.alpha?.path).toBe(path.join("wiki", "alpha.md"));
  });

  it("creates the expanded local layout and stores raw source material", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);

    const rawRef = await writeRawSourceEntry({
      id: "alpha-source",
      created: "2026-04-26T00:00:00.000Z",
      sourceType: "inline",
      title: "Alpha Source",
      tags: ["one"],
      content: "immutable source",
    }, paths);

    const rawContent = await readPatchFile(path.join(paths.root, rawRef));

    expect(paths.rawDir.endsWith(path.join(".fleet-memory", "raw"))).toBe(true);
    expect(paths.schemaDir.endsWith(path.join(".fleet-memory", "schema"))).toBe(true);
    expect(paths.conflictsDir.endsWith(path.join(".fleet-memory", "conflicts"))).toBe(true);
    expect(rawContent).toContain("immutable source");
  });

  it("rejects unsafe IDs before writing workspace-local files", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);

    await expect(writeRawSourceEntry({
      id: "../escape",
      created: "2026-04-26T00:00:00.000Z",
      sourceType: "inline",
      tags: [],
      content: "bad",
    }, paths)).rejects.toThrow(/unsafe memory id/);
  });

  it("leaves no partial temp files after repeated writes", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const entry = {
      id: "race",
      title: "Race",
      tags: [],
      created: "2026-04-26T00:00:00.000Z",
      updated: "2026-04-26T00:00:00.000Z",
      version: 1,
      body: "v1",
    };

    await Promise.all([
      writeWikiEntry(entry, paths),
      writeWikiEntry({ ...entry, body: "v2", updated: "2026-04-26T00:00:01.000Z" }, paths),
    ]);

    const files = await readdir(paths.wikiDir);
    expect(files.some((name) => name.startsWith(".tmp-"))).toBe(false);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleet-memory-store-"));
  cleanupPaths.push(root);
  return root;
}
