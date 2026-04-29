import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveMemoryPaths } from "../src/paths.js";
import { appendLogEntry, listLog, loadIndex, readPatchFile, readWikiEntry, rebuildIndex, writeRawSourceEntry, writeWikiEntry } from "../src/store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("wiki store", () => {
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
      rawSourceRef: "raw/2026-04-26-alpha-source.md",
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
    expect(wiki?.rawSourceRef).toBe("raw/2026-04-26-alpha-source.md");
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

    expect(paths.rawDir.endsWith(path.join(".fleet/knowledge", "raw"))).toBe(true);
    expect(paths.schemaDir.endsWith(path.join(".fleet/knowledge", "schema"))).toBe(true);
    expect(paths.conflictsDir.endsWith(path.join(".fleet/knowledge", "conflicts"))).toBe(true);
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
    }, paths)).rejects.toThrow(/unsafe wiki id/);
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

  it("escapes frontmatter control characters without changing logical values", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const title = "Alpha \"Quoted\"\nLine";
    const tag = "tag\\slash\rreturn";
    const proposer = "tool:\"wiki\"\noperator";
    const kind = "aar\"kind";

    await writeWikiEntry({
      id: "escape-alpha",
      title,
      tags: [tag],
      created: "2026-04-26T00:00:00.000Z",
      updated: "2026-04-26T00:00:00.000Z",
      version: 1,
      rawSourceRef: "raw/escape.md",
      body: "safe body",
    }, paths);

    await appendLogEntry({
      id: "escape-log",
      created: "2026-04-26T00:00:00.000Z",
      kind,
      title,
      tags: [tag],
      proposer,
      refs: ["escape-alpha"],
      body: "after action",
    }, paths);

    const wikiFile = await readFile(path.join(paths.wikiDir, "escape-alpha.md"), "utf8");
    const rawRef = await writeRawSourceEntry({
      id: "escape-source",
      created: "2026-04-26T00:00:00.000Z",
      sourceType: "inline",
      title,
      tags: [tag],
      content: proposer,
    }, paths);
    const rawFile = await readFile(path.join(paths.root, rawRef), "utf8");
    const wiki = await readWikiEntry("escape-alpha", paths);
    const [log] = await listLog(paths);

    expect(wikiFile).toContain('title: "Alpha \\"Quoted\\"\\nLine"');
    expect(wikiFile).toContain('tags: ["tag\\\\slash\\rreturn"]');
    expect(rawFile).toContain('title: "Alpha \\"Quoted\\"\\nLine"');
    expect(rawFile).toContain('tags: ["tag\\\\slash\\rreturn"]');
    expect(rawFile).toContain('---\ntool:"wiki"\noperator');
    expect(wiki?.title).toBe(title);
    expect(wiki?.tags).toEqual([tag]);
    expect(log?.kind).toBe(kind);
    expect(log?.title).toBe(title);
    expect(log?.tags).toEqual([tag]);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleet-wiki-store-"));
  cleanupPaths.push(root);
  return root;
}
