import { describe, expect, it, vi } from "vitest";

const runBackground = vi.fn(async (opts: any) => {
  return {
    status: "done",
    responseText: "ok",
    sessionId: "session-1",
    error: undefined,
    thinking: "thinking",
    toolCalls: [{ title: "Read", status: "done" }],
    observedOptions: opts,
  };
});

vi.mock("../../src/fleet.js", () => ({
  getFleetRuntime: () => ({
    agent: {
      runBackground,
    },
  }),
}));

import { createPanelStreamingSink } from "../../src/agent/ui/agent-panel/streaming-sink.js";
import { runAgentRequestBackground } from "../../src/agent/runner.js";
import { getState, syncColsWithRegisteredOrder } from "../../src/agent/ui/panel/state.js";
import * as panelState from "../../src/agent/ui/panel/state.js";
import { resetRuns } from "@sbluemin/fleet-core/admiral/bridge/run-stream";
import { CARRIER_FRAMEWORK_KEY } from "@sbluemin/fleet-core/admiral/carrier";
import { isStaleExtensionContextError } from "../../src/shell/context-errors.js";
import { syncCurrentWidget, syncWidget } from "../../src/agent/ui/panel/widget-sync.js";

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
    expect(runBackground).toHaveBeenCalledWith(expect.objectContaining({
      carrierId: "genesis",
      cwd: "/tmp/background",
    }));
    expect(runBackground).toHaveBeenCalledWith(expect.not.objectContaining({ ctx: expect.anything() }));
    expect(result.toolCalls).toEqual([{ title: "Read", status: "done" }]);
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

  it("resolves foreground request ctx for panel lifecycle after ctx-less runtime initialization", async () => {
    resetPanelGlobals();
    const ctx = {
      sessionManager: { getSessionId: () => "session-1" },
      ui: { setWidget: vi.fn() },
    };
    const sink = createPanelStreamingSink(() => ctx as any);

    syncColsWithRegisteredOrder();
    getState().cols = [{ cli: "genesis", text: "", blocks: [], thinking: "", toolCalls: [], status: "wait", scroll: 0 }];
    expect(panelState.findColIndex("genesis")).toBe(0);
    sink.onAgentStreamEvent({ type: "request_begin", key: { carrierId: "genesis", cli: "codex" } });
    sink.onAgentStreamEvent({ type: "request_end", key: { carrierId: "genesis", cli: "codex" }, reason: "done" });
    syncCurrentWidget();
    await Promise.resolve();

    expect(ctx.ui.setWidget).toHaveBeenCalled();
    expect(getState().streaming).toBe(false);
  });

  it("uses the begin-time ctx when ending an overlapping foreground stream", async () => {
    resetPanelGlobals();
    const ctxA = makeCtx();
    const ctxB = makeCtx();
    const contexts = [ctxA, ctxB];
    const sink = createPanelStreamingSink(() => contexts.shift() as any);

    syncColsWithRegisteredOrder();
    getState().cols = [{ cli: "genesis", text: "", blocks: [], thinking: "", toolCalls: [], status: "wait", scroll: 0 }];
    sink.onAgentStreamEvent({ type: "request_begin", key: { carrierId: "genesis", cli: "codex" } });
    sink.onAgentStreamEvent({ type: "request_end", key: { carrierId: "genesis", cli: "codex" }, reason: "done" });
    await Promise.resolve();

    expect(ctxA.ui.setWidget).toHaveBeenCalled();
    expect(ctxB.ui.setWidget).not.toHaveBeenCalled();
    expect(getState().streaming).toBe(false);
  });
});

function resetPanelGlobals(): void {
  resetRuns();
  (globalThis as any)["__pi_agent_panel_state__"] = undefined;
  (globalThis as any)[CARRIER_FRAMEWORK_KEY] = {
    modes: new Map(),
    registeredOrder: ["genesis"],
    statusUpdateCallbacks: [],
    sortieDisabledCarriers: new Set(),
    taskforceConfiguredCarriers: new Set(),
    squadronEnabledCarriers: new Set(),
    pendingCliTypeOverrides: new Map(),
  };
}

function makeCtx(error?: Error): { sessionManager: { getSessionId: () => string }; ui: { setWidget: ReturnType<typeof vi.fn> } } {
  const setWidget = vi.fn(() => {
    if (error) throw error;
  });
  return {
    sessionManager: { getSessionId: () => "session-1" },
    ui: { setWidget },
  };
}
