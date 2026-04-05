import { beforeEach, describe, expect, it } from "vitest";
import { CARRIER_FRAMEWORK_KEY } from "../shipyard/carrier/types.js";
import { createRun, finalizeRun } from "../streaming/stream-store.js";
import type { AgentCol } from "../panel/types.js";
import { getState, makeFooterCols } from "../panel/state.js";

function makeCol(cli: string, status: AgentCol["status"]): AgentCol {
  return {
    cli,
    sessionId: `${cli}-session`,
    text: "",
    blocks: [],
    thinking: "",
    toolCalls: [],
    status,
    scroll: 0,
  };
}

beforeEach(() => {
  (globalThis as any)["__pi_agent_panel_state__"] = undefined;
  (globalThis as any)["__pi_stream_store__"] = undefined;
  // carrier framework 상태를 테스트용으로 설정 (getRegisteredOrder 대응)
  (globalThis as any)[CARRIER_FRAMEWORK_KEY] = {
    modes: new Map(),
    registeredOrder: ["genesis", "sentinel", "vanguard"],
    statusUpdateCallbacks: [],
  };
});

describe("makeFooterCols", () => {
  it("부분 모드에서도 footer는 전체 CLI 슬롯을 유지한다", () => {
    const state = getState();
    state.cols = [
      makeCol("genesis", "stream"),
      makeCol("sentinel", "done"),
    ];

    createRun("vanguard");
    finalizeRun("vanguard", "done", {
      sessionId: "vanguard-last-session",
      fallbackText: "previous output",
    });

    const footerCols = makeFooterCols();

    expect(footerCols.map((col) => col.cli)).toEqual(["genesis", "sentinel", "vanguard"]);
    expect(footerCols[0]?.status).toBe("stream");
    expect(footerCols[1]?.status).toBe("done");
    expect(footerCols[2]?.status).toBe("wait");
    expect(footerCols[2]?.sessionId).toBe("vanguard-last-session");
  });
});
