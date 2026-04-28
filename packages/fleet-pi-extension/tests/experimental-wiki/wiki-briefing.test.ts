import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { briefingQuery } from "../../src/experimental-wiki/briefing.js";
import { resolveMemoryPaths } from "../../src/experimental-wiki/paths.js";
import { writeWikiEntry } from "../../src/experimental-wiki/store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("wiki briefing", () => {
  it("ranks id before tag before title before body", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);

    await writeWikiEntry({
      id: "apollo",
      title: "Mission Notes",
      tags: ["launch"],
      created: "2026-04-26T00:00:00.000Z",
      updated: "2026-04-26T00:00:00.000Z",
      version: 1,
      body: "plain body",
    }, paths);
    await writeWikiEntry({
      id: "beta",
      title: "Launch Procedures",
      tags: ["ops"],
      created: "2026-04-26T00:00:00.000Z",
      updated: "2026-04-26T00:00:00.000Z",
      version: 1,
      body: "plain body",
    }, paths);
    await writeWikiEntry({
      id: "gamma",
      title: "Misc",
      tags: ["misc"],
      created: "2026-04-26T00:00:00.000Z",
      updated: "2026-04-26T00:00:00.000Z",
      version: 1,
      body: "launch details hidden in body ".repeat(20),
    }, paths);

    const byId = await briefingQuery(paths, { topic: "apollo", limit: 3 });
    const byTag = await briefingQuery(paths, { tags: ["launch"], limit: 3 });
    const byTitleAndBody = await briefingQuery(paths, { topic: "launch", limit: 3 });

    expect(byId[0]?.reason).toBe("id");
    expect(byTag[0]?.reason).toBe("tag");
    expect(byTitleAndBody[0]?.reason).toBe("title");
    expect(byTitleAndBody[1]?.reason).toBe("body");
    expect(byTitleAndBody[1]?.excerpt.length).toBeLessThanOrEqual(160);
  });

  it("respects the limit", async () => {
    const root = await makeTempRoot();
    const paths = resolveMemoryPaths(root);
    for (const id of ["a", "b", "c"]) {
      await writeWikiEntry({
        id,
        title: `Title ${id}`,
        tags: ["tag"],
        created: "2026-04-26T00:00:00.000Z",
        updated: "2026-04-26T00:00:00.000Z",
        version: 1,
        body: "body",
      }, paths);
    }

    const hits = await briefingQuery(paths, { tags: ["tag"], limit: 2 });
    expect(hits).toHaveLength(2);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleet-wiki-briefing-"));
  cleanupPaths.push(root);
  return root;
}
