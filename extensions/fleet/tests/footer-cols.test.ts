import { beforeEach, describe, expect, it } from "vitest";
import { CARRIER_FRAMEWORK_KEY } from "../carrier/types.js";
import { createRun, finalizeRun } from "../internal/streaming/stream-store.js";
import type { AgentCol } from "../internal/contracts.js";
import { getState, makeFooterCols } from "../internal/panel/state.js";

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
    registeredOrder: ["claude", "codex", "gemini"],
    activeModeId: null,
    inputRegistered: false,
    cancelShortcutRegistered: false,
    statusUpdateCallbacks: [],
  };
});

describe("makeFooterCols", () => {
  it("부분 모드에서도 footer는 전체 CLI 슬롯을 유지한다", () => {
    const state = getState();
    state.cols = [
      makeCol("claude", "stream"),
      makeCol("codex", "done"),
    ];

    createRun("gemini");
    finalizeRun("gemini", "done", {
      sessionId: "gemini-last-session",
      fallbackText: "previous output",
    });

    const footerCols = makeFooterCols();

    expect(footerCols.map((col) => col.cli)).toEqual(["claude", "codex", "gemini"]);
    expect(footerCols[0]?.status).toBe("stream");
    expect(footerCols[1]?.status).toBe("done");
    expect(footerCols[2]?.status).toBe("wait");
    expect(footerCols[2]?.sessionId).toBe("gemini-last-session");
  });
});
