import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { showQueue } from "../memory/patch.js";
import { resolveMemoryPaths } from "../memory/paths.js";
import { listLog, pathExists } from "../memory/store.js";
import { buildAarProposeToolConfig } from "../memory/tools/aar.js";
import { buildIngestToolConfig } from "../memory/tools/ingest.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("memory tools", () => {
  it("ingest captures raw source before proposing a wiki patch", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const tool = buildIngestToolConfig();

    const result = await tool.execute("tool-call", {
      id: "alpha",
      title: "Alpha",
      body: "candidate knowledge",
      tags: ["one"],
      source: "original source text",
    }, undefined, undefined, { cwd: root } as any);
    const payload = JSON.parse(result.content[0]!.text) as { patch_id: string; raw_source_ref: string };
    const queued = await showQueue(payload.patch_id, paths);

    expect(await pathExists(path.join(paths.root, payload.raw_source_ref))).toBe(true);
    expect(queued.meta.rawSourceRef).toBe(payload.raw_source_ref);
    expect(await pathExists(path.join(paths.wikiDir, "alpha.md"))).toBe(false);
  });

  it("ingest rejects secret-like raw source content", async () => {
    const root = await makeTempRoot();
    const tool = buildIngestToolConfig();

    await expect(tool.execute("tool-call", {
      id: "secret",
      title: "Secret",
      body: "candidate knowledge",
      tags: [],
      source: "api_key=abcdefghijklmnopqrstuvwxyz",
    }, undefined, undefined, { cwd: root } as any)).rejects.toThrow(/secret-like content/);
  });

  it("AAR auto_apply writes only log and archive artifacts", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    const tool = buildAarProposeToolConfig();

    const result = await tool.execute("tool-call", {
      id: "aar-1",
      kind: "session",
      body: "after action",
      auto_apply: true,
    }, undefined, undefined, { cwd: root } as any);
    const payload = JSON.parse(result.content[0]!.text) as { archive: string };
    const logs = await listLog(paths);

    expect(logs).toHaveLength(1);
    expect(await pathExists(path.join(paths.root, payload.archive))).toBe(true);
    expect(await pathExists(path.join(paths.wikiDir, "aar-1.md"))).toBe(false);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleet-memory-tools-"));
  cleanupPaths.push(root);
  return root;
}
