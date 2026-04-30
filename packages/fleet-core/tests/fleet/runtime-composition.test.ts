import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getDataDir } from "../../src/admiral/_shared/agent-runtime.js";
import { getSettingsService } from "../../src/services/settings/runtime.js";
import { createFleetCoreRuntime } from "../../src/public/runtime.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-runtime-composition-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createFleetCoreRuntime", () => {
  it("initializes the domain service runtime context", async () => {
    const dataDir = path.join(tmpDir, "core", ".data");
    const runtime = createFleetCoreRuntime({ dataDir } as any);

    expect("agent" in runtime).toBe(false);
    expect("toolRegistry" in runtime).toBe(false);
    expect(runtime.settings.settings).toBeTruthy();
    expect(Array.isArray(runtime.fleet.tools)).toBe(true);
    expect(runtime.fleet.carrier).toBeTruthy();
    expect(runtime.fleet.protocols).toBeTruthy();
    expect(runtime.jobs.archive).toBeTruthy();
    expect(runtime.jobs.carrierJobs).toBeTruthy();
    expect(runtime.metaphor.core).toBeTruthy();
    expect(runtime.grandFleet.admiralty).toBeTruthy();
    expect("keybind" in runtime.settings).toBe(false);
    expect(runtime.shutdown).toEqual(expect.any(Function));
    expect(getDataDir()).toBe(dataDir);
    expect(fs.existsSync(dataDir)).toBe(true);

    await runtime.shutdown();
  });

  it("keeps settings section registration mutable after runtime creation", async () => {
    const runtime = createFleetCoreRuntime({ dataDir: tmpDir } as any);

    runtime.settings.settings.registerSection({
      key: "runtime-section",
      displayName: "Runtime Section",
      getDisplayFields() {
        return [{ label: "Enabled", value: "ON", color: "accent" }];
      },
    });

    expect(runtime.settings.settings.getSections()).toEqual([
      {
        key: "runtime-section",
        displayName: "Runtime Section",
        getDisplayFields: expect.any(Function),
      },
    ]);

    await runtime.shutdown();
  });

  it("does not clear a newer settings singleton during stale runtime shutdown", async () => {
    const olderRuntime = createFleetCoreRuntime({
      dataDir: path.join(tmpDir, "older"),
    } as any);
    const newerRuntime = createFleetCoreRuntime({
      dataDir: path.join(tmpDir, "newer"),
    } as any);

    expect(getSettingsService()).toBe(newerRuntime.settings.settings);

    await olderRuntime.shutdown();

    expect(getSettingsService()).toBe(newerRuntime.settings.settings);

    await newerRuntime.shutdown();
    expect(getSettingsService()).toBeNull();
  });

});
