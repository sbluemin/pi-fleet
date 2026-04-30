import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const runBackground = vi.fn();

vi.mock("../../src/session/runtime/fleet-boot.js", () => ({
  getFleetRuntime: () => ({
    agent: {
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
import { createPanelStreamingSink } from "../../src/tui/agent-panel/streaming-sink.js";
import { getState } from "../../src/tui/panel/state.js";
import { getRunById, listRuns, resetRuns } from "@sbluemin/fleet-core/admiral/bridge/run-stream";
import { CARRIER_FRAMEWORK_KEY } from "@sbluemin/fleet-core/admiral/carrier";

beforeEach(() => {
  run.mockReset();
  runBackground.mockReset();
  run.mockResolvedValue(createResult("run"));
  runBackground.mockResolvedValue(createResult("background"));
  resetPanelGlobals();
});

describe("operation runner adapter", () => {
  it("strips ctx and delegates foreground requests to runtime.agent", async () => {
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

  it("delegates background requests to runtime.agent.runBackground", async () => {
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

    sink.onAgentStreamEvent({ type: "request_begin", key: { carrierId: "genesis", cli: "codex" } });
    sink.onAgentStreamEvent({ type: "status", key: { carrierId: "genesis", cli: "codex" }, status: "running" });
    sink.onAgentStreamEvent({ type: "thought", key: { carrierId: "genesis", cli: "codex" }, text: "think" });
    sink.onAgentStreamEvent({
      type: "tool",
      key: { carrierId: "genesis", cli: "codex" },
      title: "Read",
      status: "done",
      toolCallId: "tool-1",
    });
    sink.onAgentStreamEvent({ type: "message", key: { carrierId: "genesis", cli: "codex" }, text: "hello" });
    sink.onAgentStreamEvent({
      type: "request_end",
      key: { carrierId: "genesis", cli: "codex" },
      reason: "done",
      sessionId: "session-1",
      responseText: "hello",
      thoughtText: "think",
    });

    const state = getState();
    expect(state.cols[0]).toMatchObject({
      cli: "genesis",
      status: "done",
      text: "hello",
      thinking: "think",
      sessionId: "session-1",
    });
    expect(state.streaming).toBe(false);
  });

  it("keeps same-carrier foreground streams isolated by request id", () => {
    const ctx = makeCtx();
    const sink = createPanelStreamingSink(ctx as any);
    const firstKey = { carrierId: "genesis", cli: "codex" as const, requestId: "request-1" };
    const secondKey = { carrierId: "genesis", cli: "codex" as const, requestId: "request-2" };

    sink.onAgentStreamEvent({ type: "request_begin", key: firstKey });
    const firstRunId = listRuns().at(-1)?.runId;
    sink.onAgentStreamEvent({ type: "request_begin", key: secondKey });
    const secondRunId = listRuns().at(-1)?.runId;

    sink.onAgentStreamEvent({ type: "message", key: firstKey, text: "first" });
    sink.onAgentStreamEvent({ type: "message", key: secondKey, text: "second" });
    sink.onAgentStreamEvent({ type: "request_end", key: firstKey, reason: "done", responseText: "first" });
    sink.onAgentStreamEvent({ type: "request_end", key: secondKey, reason: "done", responseText: "second" });

    expect(firstRunId).toBeTruthy();
    expect(secondRunId).toBeTruthy();
    expect(firstRunId).not.toBe(secondRunId);
    expect(getRunById(firstRunId!)?.text).toBe("first");
    expect(getRunById(secondRunId!)?.text).toBe("second");
    expect(getState().cols[0]).toMatchObject({
      status: "done",
      text: "second",
    });
  });

  it("short-circuits panel streaming sink when the carrier column is missing", () => {
    const ctx = makeCtx();
    const sink = createPanelStreamingSink(ctx as any);

    sink.onAgentStreamEvent({ type: "request_begin", key: { carrierId: "missing", cli: "codex" } });
    sink.onAgentStreamEvent({ type: "message", key: { carrierId: "missing", cli: "codex" }, text: "ignored" });
    sink.onAgentStreamEvent({ type: "request_end", key: { carrierId: "missing", cli: "codex" }, reason: "done" });

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
  resetRuns(["genesis"]);
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
