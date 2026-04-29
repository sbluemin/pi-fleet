import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { refreshStatusNow, type ServiceStatusContextPort } from "../../src/agent/service-status/store.js";
import { getDataDir } from "../../src/agent/runtime.js";
import { getToolsForSession } from "../../src/agent/tool-snapshot.js";
import { createFleetCoreRuntime } from "../../src/public/runtime.js";
import type { FleetHostPorts } from "../../src/public/host-ports.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-runtime-composition-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createFleetCoreRuntime", () => {
  it("initializes runtime, store, agent runtime, and MCP composition", async () => {
    const dataDir = path.join(tmpDir, "core", ".data");
    const runtime = createFleetCoreRuntime({ dataDir, ports: createMinimalPorts() });

    expect(runtime.agent).toBeTruthy();
    expect(runtime.toolRegistry).toBe(runtime.agent.toolRegistry);
    expect(runtime.mcp).toBe(runtime.agent.mcp);
    expect(runtime.jobs).toEqual({});
    expect(runtime.carriers).toEqual({});
    expect(runtime.admiral).toEqual({});
    expect(runtime.metaphor).toEqual({});
    expect(runtime.shutdown).toEqual(expect.any(Function));
    expect(getDataDir()).toBe(dataDir);
    expect(fs.existsSync(dataDir)).toBe(true);

    await runtime.shutdown();
  });

  it("wires optional service-status callbacks through the public runtime", async () => {
    const setLoading = vi.fn();
    const setStatus = vi.fn();
    const runtime = createFleetCoreRuntime({
      dataDir: tmpDir,
      ports: {
        ...createMinimalPorts(),
        serviceStatus: { setLoading, setStatus },
      },
    });

    await refreshStatusNow(createStatusContext());

    expect(setLoading).toHaveBeenCalledOnce();

    await runtime.shutdown();
  });

  it("allows hosts to omit service-status callbacks", async () => {
    const runtime = createFleetCoreRuntime({ dataDir: tmpDir, ports: createMinimalPorts() });

    await expect(refreshStatusNow(createStatusContext())).resolves.toBeUndefined();
    await runtime.shutdown();
  });

  it("clears previous service-status callbacks when callbacks are omitted", async () => {
    const staleSetLoading = vi.fn();
    const runtimeWithStatus = createFleetCoreRuntime({
      dataDir: path.join(tmpDir, "with-status"),
      ports: {
        ...createMinimalPorts(),
        serviceStatus: {
          setLoading: staleSetLoading,
          setStatus() {},
        },
      },
    });
    await runtimeWithStatus.shutdown();

    const runtimeWithoutStatus = createFleetCoreRuntime({
      dataDir: path.join(tmpDir, "without-status"),
      ports: createMinimalPorts(),
    });

    await refreshStatusNow(createStatusContext());

    expect(staleSetLoading).not.toHaveBeenCalled();

    await runtimeWithoutStatus.shutdown();
  });

  it("clears runtime-owned service-status callbacks during shutdown", async () => {
    const setLoading = vi.fn();
    const runtime = createFleetCoreRuntime({
      dataDir: tmpDir,
      ports: {
        ...createMinimalPorts(),
        serviceStatus: {
          setLoading,
          setStatus() {},
        },
      },
    });

    await runtime.shutdown();
    await refreshStatusNow(createStatusContext());

    expect(setLoading).not.toHaveBeenCalled();
  });

  it("closes MCP servers created after construction during shutdown", async () => {
    const runtime = createFleetCoreRuntime({ dataDir: tmpDir, ports: createMinimalPorts() });
    runtime.toolRegistry.register({
      name: "runtime_composition_tool",
      label: "Runtime Composition Tool",
      description: "Test tool",
      parameters: { type: "object", properties: {} },
      async execute() { return {}; },
    });
    runtime.mcp.createServer({ sessionToken: "runtime-composition-test" });

    expect(getToolsForSession("runtime-composition-test")).toHaveLength(1);

    await runtime.shutdown();

    expect(getToolsForSession("runtime-composition-test")).toHaveLength(0);
  });
});

function createMinimalPorts(): FleetHostPorts {
  return {
    appendStreamBlock() {},
    syncPanelColumn() {},
    endStreamColumn() {},
    sendCarrierResultPush() {},
    notify() {},
    loadSetting() { return undefined; },
    saveSetting() {},
    registerKeybind() { return () => {}; },
    log() {},
    now: () => Date.now(),
    getDeliverAs() { return undefined; },
  };
}

function createStatusContext(): ServiceStatusContextPort {
  return {
    hasUI: false,
    getSessionId() { return "runtime-composition-test"; },
    notify() {},
  };
}
