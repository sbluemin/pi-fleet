import { describe, expect, it, vi } from "vitest";

vi.mock("@sbluemin/fleet-core/agent", () => ({
  executeWithPool: vi.fn(async (opts: any) => {
    opts.onStatusChange?.("streaming");
    opts.onMessageChunk?.("hello");
    opts.onThoughtChunk?.("thinking");
    opts.onToolCall?.("Read", "done", "raw", "tool-1");
    return {
      status: "done",
      responseText: "ok",
      thoughtText: "thinking",
      error: undefined,
      toolCalls: [{ title: "Read", status: "done" }],
      connectionInfo: { sessionId: "session-1" },
    };
  }),
}));

vi.mock("@sbluemin/fleet-core/store", () => ({
  loadModels: () => ({}),
}));

import { executeWithPool } from "@sbluemin/fleet-core/agent";
import { runAgentRequestBackground } from "../../src/session-bridge/fleet/operation-runner.js";
import { getRunById, getVisibleRun, resetRuns } from "@sbluemin/fleet-core/bridge/streaming";
import { CARRIER_FRAMEWORK_KEY } from "@sbluemin/fleet-core/carrier";
import { isStaleExtensionContextError } from "../../src/tui/context-errors.js";
import { syncCurrentWidget, syncWidget } from "../../src/tui/panel/widget-sync.js";

describe("background ctx isolation", () => {
  it("runs background carrier requests with explicit cwd and no ExtensionContext", async () => {
    resetPanelGlobals();

    const result = await runAgentRequestBackground({
      cli: "codex",
      carrierId: "genesis",
      request: "work",
      cwd: "/tmp/background",
    });

    expect(result.status).toBe("done");
    expect(executeWithPool).toHaveBeenCalledWith(expect.objectContaining({
      carrierId: "genesis",
      cwd: "/tmp/background",
    }));
    expect(executeWithPool).toHaveBeenCalledWith(expect.not.objectContaining({ ctx: expect.anything() }));
    expect(getVisibleRun("genesis")?.status).toBe("done");
    expect(getRunById(getVisibleRun("genesis")!.runId)?.text).toBe("hello");
  });

  it("classifies outside-active-run and stale context errors only", () => {
    expect(isStaleExtensionContextError(new Error("Agent listener invoked outside active run"))).toBe(true);
    expect(isStaleExtensionContextError(new Error("stale extension context after session replacement"))).toBe(true);
    expect(isStaleExtensionContextError(new Error("ordinary renderer failure"))).toBe(false);
  });

  it("detaches stale widget ctx without crashing background-safe updates", async () => {
    resetPanelGlobals();
    const staleCtx = makeCtx(new Error("Agent listener invoked outside active run"));
    syncWidget(staleCtx as any);
    syncCurrentWidget();
    await Promise.resolve();
  });
});

function resetPanelGlobals(): void {
  resetRuns();
  (globalThis as any)["__pi_agent_panel_state__"] = undefined;
  (globalThis as any)[CARRIER_FRAMEWORK_KEY] = {
    modes: new Map(),
    registeredOrder: ["genesis"],
    statusUpdateCallbacks: [],
  };
}

function makeCtx(error: Error): { sessionManager: { getSessionId: () => string }; ui: { setWidget: () => never } } {
  return {
    sessionManager: { getSessionId: () => "session-1" },
    ui: {
      setWidget: () => {
        throw error;
      },
    },
  };
}
