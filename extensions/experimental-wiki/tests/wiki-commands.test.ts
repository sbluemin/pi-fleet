import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerWikiCommands } from "../commands.js";
import { enqueuePatch, parsePatch } from "../patch.js";
import { resolveMemoryPaths } from "../paths.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("wiki commands", () => {
  it("shows queue selection guidance as a warning instead of throwing for unknown show IDs", async () => {
    const root = await makeTempRoot();
    const patchId = await seedPatch(root, "alpha");
    const { config } = registerCommand("fleet:wiki:show");
    const notify = vi.fn();

    await expect(config.handler("missing", makeContext(root, notify))).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledWith(`Unknown patch ID. Available patch IDs: ${patchId}`, "warning");
  });

  it("shows queue selection guidance as a warning instead of throwing for unknown approve/reject IDs", async () => {
    const root = await makeTempRoot();
    const patchId = await seedPatch(root, "beta");
    const approve = registerCommand("fleet:wiki:approve").config;
    const reject = registerCommand("fleet:wiki:reject").config;
    const approveNotify = vi.fn();
    const rejectNotify = vi.fn();

    await expect(approve.handler("missing", makeContext(root, approveNotify))).resolves.toBeUndefined();
    await expect(reject.handler("missing nope", makeContext(root, rejectNotify))).resolves.toBeUndefined();

    expect(approveNotify).toHaveBeenCalledWith(`Unknown patch ID. Available patch IDs: ${patchId}`, "warning");
    expect(rejectNotify).toHaveBeenCalledWith(`Unknown patch ID. Available patch IDs: ${patchId}`, "warning");
  });
});

function registerCommand(name: string): { config: any } {
  const registerCommand = vi.fn();
  registerWikiCommands({ registerCommand, sendUserMessage: vi.fn() } as any);
  const [, config] = registerCommand.mock.calls.find(([commandName]) => commandName === name) ?? [];
  return { config };
}

function makeContext(root: string, notify: ReturnType<typeof vi.fn>): any {
  return {
    cwd: root,
    ui: {
      notify,
      select: vi.fn(),
    },
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => "session-1",
    },
  };
}

async function seedPatch(root: string, id: string): Promise<string> {
  const paths = resolveMemoryPaths(root);
  const patch = await parsePatch(`---\nop: "create_wiki"\ntarget: "wiki/${id}.md"\nsummary: "${id}"\nproposer: "test"\ncreated: "2026-04-26T00:00:00.000Z"\n---\n{"id":"${id}","title":"${id}","tags":[],"created":"2026-04-26T00:00:00.000Z","updated":"2026-04-26T00:00:00.000Z","version":1,"body":"hello"}`);
  return enqueuePatch(patch, paths);
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fleet-wiki-commands-"));
  cleanupPaths.push(root);
  return root;
}
