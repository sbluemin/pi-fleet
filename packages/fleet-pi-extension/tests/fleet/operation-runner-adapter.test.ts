import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const runBackground = vi.fn();

vi.mock("../../src/bindings/runtime/fleet-boot.js", () => ({
  getFleetRuntime: () => ({
    agentRequest: {
      run,
      runBackground,
    },
  }),
  withAgentRequestContext: async (_ctx: any, callback: () => Promise<unknown>) => callback(),
}));

import {
  exposeAgentApi,
  runAgentRequest,
  runAgentRequestBackground,
} from "../../src/session/fleet/operation-runner.js";
import { createPanelStreamingSink } from "../../src/bindings/carrier/panel-streaming-sink.js";
import { getState } from "../../src/tui/panel/state.js";
import { CARRIER_FRAMEWORK_KEY } from "@sbluemin/fleet-core/carrier";

beforeEach(() => {
  run.mockReset();
  runBackground.mockReset();
  run.mockResolvedValue(createResult("run"));
  runBackground.mockResolvedValue(createResult("background"));
  resetPanelGlobals();
});

describe("operation runner adapter", () => {
  it("strips ctx and delegates foreground requests to runtime.agentRequest", async () => {
    const ctx = { cwd: "/workspace" };

    const result = await runAgentRequest({
      cli: "codex",
      carrierId: "genesis",
      request: "work",
      ctx: ctx as any,
    });

    expect(result.responseText).toBe("run");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cli: "codex",
      carrierId: "genesis",
      request: "work",
      cwd: "/workspace",
    }));
    expect(run).toHaveBeenCalledWith(expect.not.objectContaining({ ctx: expect.anything() }));
  });

  it("delegates background requests to runtime.agentRequest.runBackground", async () => {
    const result = await runAgentRequestBackground({
      cli: "codex",
      carrierId: "genesis",
      request: "background",
      cwd: "/workspace",
    });

    expect(result.responseText).toBe("background");
    expect(runBackground).toHaveBeenCalledWith(expect.objectContaining({
      carrierId: "genesis",
      cwd: "/workspace",
    }));
  });

  it("exposes the legacy global unified-agent bridge", async () => {
    const bridge = exposeAgentApi();
    const globalBridge = (globalThis as any)["__pi_ua_request__"];

    expect(globalBridge).toBe(bridge);
    await expect(globalBridge.requestUnifiedAgent({
      cli: "codex",
      carrierId: "genesis",
      request: "work",
      ctx: { cwd: "/workspace" },
    })).resolves.toEqual(createResult("run"));
  });

  it("maps panel streaming sink events to panel column lifecycle", () => {
    const ctx = makeCtx();
    const sink = createPanelStreamingSink(ctx as any);

    sink.onColumnBegin({ carrierId: "genesis", cli: "codex" });
    sink.onColumnUpdate({ carrierId: "genesis", cli: "codex" }, {
      status: "running",
      text: "hello",
      thinking: "think",
      toolCalls: [{ title: "Read", status: "done" }],
      blocks: [{ type: "text", text: "hello" }],
      sessionId: "session-1",
    });
    sink.onColumnEnd({ carrierId: "genesis", cli: "codex" }, "done");

    const state = getState();
    expect(state.cols[0]).toMatchObject({
      cli: "genesis",
      status: "stream",
      text: "hello",
      thinking: "think",
      sessionId: "session-1",
    });
    expect(state.streaming).toBe(false);
  });

  it("short-circuits panel streaming sink when the carrier column is missing", () => {
    const ctx = makeCtx();
    const sink = createPanelStreamingSink(ctx as any);

    sink.onColumnBegin({ carrierId: "missing", cli: "codex" });
    sink.onColumnUpdate({ carrierId: "missing", cli: "codex" }, { text: "ignored" });
    sink.onColumnEnd({ carrierId: "missing", cli: "codex" }, "done");

    expect(getState().cols[0]?.text).toBe("");
  });

});

function createResult(responseText: string) {
  return {
    status: "done",
    responseText,
    sessionId: "session-1",
    error: undefined,
    thinking: "think",
    toolCalls: [{ title: "Read", status: "done" }],
    blocks: [{ type: "text", text: responseText }],
  };
}

function resetPanelGlobals(): void {
  (globalThis as any)["__pi_agent_panel_state__"] = undefined;
  (globalThis as any)[CARRIER_FRAMEWORK_KEY] = {
    modes: new Map(),
    registeredOrder: ["genesis"],
    statusUpdateCallbacks: [],
  };
}

function makeCtx(sessionId = "session-1"): { cwd: string; sessionManager: { getSessionId: () => string }; ui: { setWidget: ReturnType<typeof vi.fn> } } {
  return {
    cwd: "/workspace",
    sessionManager: { getSessionId: () => sessionId },
    ui: { setWidget: vi.fn() },
  };
}
