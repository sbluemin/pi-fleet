import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireJobPermit,
  getActiveBackgroundJobCount,
  resetJobConcurrencyForTest,
} from "@sbluemin/fleet-core/job";
import { CARRIER_FRAMEWORK_KEY } from "@sbluemin/fleet-core/carrier";
import type { CarrierJobRecord } from "@sbluemin/fleet-core/job";
import {
  bindPanelBackgroundJobAnimation,
  detachAgentPanelUi,
  endColStreaming,
  ensureAnimTimer,
} from "../../src/tui/panel-lifecycle.js";
import { getState, STATE_KEY } from "../../src/tui/panel/state.js";
import { syncWidget } from "../../src/tui/panel/widget-sync.js";
import type { AgentCol } from "../../src/tui/panel/types.js";

beforeEach(() => {
  vi.useFakeTimers();
  resetJobConcurrencyForTest();
  delete (globalThis as Record<string, unknown>)[STATE_KEY];
  (globalThis as any)[CARRIER_FRAMEWORK_KEY] = {
    modes: new Map([["genesis", { config: { id: "genesis", displayName: "Genesis", cliType: "codex", slot: 1, color: "" } }]]),
    registeredOrder: ["genesis"],
    sortieDisabledCarriers: new Set(),
    squadronEnabledCarriers: new Set(),
    statusUpdateCallbacks: [],
  };
});

afterEach(() => {
  detachAgentPanelUi();
  resetJobConcurrencyForTest();
  vi.useRealTimers();
});

describe("panel animation lifecycle", () => {
  it("stops the timer when no column is streaming and no background job is active", () => {
    const state = getState();
    state.cols = [buildCol("done")];
    ensureAnimTimer();
    expect(state.animTimer).not.toBeNull();

    endColStreaming(buildCtx(), 0);

    expect(state.animTimer).toBeNull();
  });

  it("keeps the timer when streaming ends while a background job is active", () => {
    const state = getState();
    state.cols = [buildCol("done")];
    const permit = acquireJobPermit(buildRecord("sortie:active", ["genesis"]));
    expect(permit.accepted).toBe(true);
    ensureAnimTimer();

    endColStreaming(buildCtx(), 0);

    expect(state.animTimer).not.toBeNull();
  });

  it("restarts the timer on the idle to active background job transition", () => {
    const state = getState();
    bindPanelBackgroundJobAnimation();
    expect(state.animTimer).toBeNull();

    const permit = acquireJobPermit(buildRecord("sortie:active", ["genesis"]));

    expect(permit.accepted).toBe(true);
    expect(getActiveBackgroundJobCount()).toBe(1);
    expect(state.animTimer).not.toBeNull();
  });

  it("stops the timer after active background jobs reach zero", () => {
    const state = getState();
    bindPanelBackgroundJobAnimation();
    const permit = acquireJobPermit(buildRecord("sortie:active", ["genesis"]));
    if (!permit.accepted) throw new Error("expected permit");
    expect(state.animTimer).not.toBeNull();

    permit.release({ status: "done", finishedAt: 2000 });
    vi.advanceTimersByTime(100);

    expect(getActiveBackgroundJobCount()).toBe(0);
    expect(state.animTimer).toBeNull();
  });

  it("renders carrier status as streaming while background jobs are active", async () => {
    const state = getState();
    state.streaming = false;
    state.frame = 0;
    state.cols = [buildCol("stream")];
    const permit = acquireJobPermit(buildRecord("sortie:active", ["genesis"]));
    expect(permit.accepted).toBe(true);
    const ctx = buildCtx();

    syncWidget(ctx);
    await Promise.resolve();
    const statusFactory = ctx.ui.setWidget.mock.calls.find((call: any[]) => call[0] === "fleet-carrier-status")?.[1];
    const rendered = statusFactory({}, {}).render(80).join("\n");

    expect(rendered).not.toContain("○ Genesis");
  });

  it("renders carrier status as idle when neither streaming nor background jobs are active", async () => {
    const state = getState();
    state.streaming = false;
    state.frame = 0;
    state.cols = [buildCol("stream")];
    const ctx = buildCtx();

    syncWidget(ctx);
    await Promise.resolve();
    const statusFactory = ctx.ui.setWidget.mock.calls.find((call: any[]) => call[0] === "fleet-carrier-status")?.[1];
    const rendered = statusFactory({}, {}).render(80).join("\n");

    expect(rendered).toContain("○");
  });
});

function buildRecord(jobId: string, carriers: string[]): CarrierJobRecord {
  return {
    jobId,
    tool: "carriers_sortie",
    status: "active",
    startedAt: 1000,
    carriers,
  };
}

function buildCol(status: AgentCol["status"]): AgentCol {
  return {
    cli: "genesis",
    text: "",
    blocks: [],
    thinking: "",
    toolCalls: [],
    status,
    scroll: 0,
  };
}

function buildCtx(): any {
  return {
    ui: { setWidget: vi.fn() },
    sessionManager: { getSessionId: () => "test-session" },
  };
}
