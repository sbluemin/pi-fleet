/**
 * stream-store 단위 테스트
 *
 * blocks를 canonical 데이터로 하는 스토어의 핵심 동작을 검증합니다.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CARRIER_FRAMEWORK_KEY } from "../carrier/types.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  updateRunStatus,
  finalizeRun,
  getVisibleRun,
  getAllVisibleRuns,
  getRunById,
  resetRuns,
} from "../internal/streaming/stream-store.js";

// 각 테스트 전에 globalThis 상태 초기화
beforeEach(() => {
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

describe("createRun", () => {
  it("새 run을 생성하고 visible로 설정한다", () => {
    const runId = createRun("claude");
    expect(runId).toContain("claude-");

    const run = getVisibleRun("claude");
    expect(run).toBeDefined();
    expect(run!.cli).toBe("claude");
    expect(run!.runId).toBe(runId);
    expect(run!.status).toBe("conn"); // 기본 initialStatus
  });

  it("같은 CLI에 두 번째 run을 생성하면 visible이 교체된다", () => {
    const runId1 = createRun("claude");
    const runId2 = createRun("claude");

    expect(runId1).not.toBe(runId2);

    const visible = getVisibleRun("claude");
    expect(visible!.runId).toBe(runId2);

    // 이전 run은 runId로 여전히 접근 가능
    const old = getRunById(runId1);
    expect(old).toBeDefined();
    expect(old!.runId).toBe(runId1);
  });
});

describe("이벤트 순서 보존", () => {
  it("thought → tool → toolUpdate → text 순서로 blocks가 누적된다", () => {
    createRun("gemini");

    appendThoughtBlock("gemini", "분석 중...");
    upsertToolBlock("gemini", "read_file", "running");
    upsertToolBlock("gemini", "read_file", "completed");
    appendTextBlock("gemini", "결과: ");
    appendTextBlock("gemini", "성공했습니다.");

    const run = getVisibleRun("gemini")!;
    expect(run.blocks).toHaveLength(3); // thought, tool, text (text 2개는 병합)

    expect(run.blocks[0].type).toBe("thought");
    expect(run.blocks[1].type).toBe("tool");
    expect(run.blocks[2].type).toBe("text");

    // tool 블록이 업데이트되었는지 확인
    const tool = run.blocks[1] as { type: "tool"; title: string; status: string };
    expect(tool.status).toBe("completed");

    // text 블록이 병합되었는지 확인
    const text = run.blocks[2] as { type: "text"; text: string };
    expect(text.text).toBe("결과: 성공했습니다.");
  });

  it("text → thought → text 순서에서 별도 블록으로 생성된다", () => {
    createRun("claude");

    appendTextBlock("claude", "첫 응답");
    appendThoughtBlock("claude", "생각 중");
    appendTextBlock("claude", "두 번째 응답");

    const run = getVisibleRun("claude")!;
    expect(run.blocks).toHaveLength(3);
    expect(run.blocks[0].type).toBe("text");
    expect(run.blocks[1].type).toBe("thought");
    expect(run.blocks[2].type).toBe("text");
  });
});

describe("파생 getter", () => {
  it("text는 모든 text 블록의 합이다", () => {
    createRun("claude");
    appendTextBlock("claude", "Hello ");
    appendThoughtBlock("claude", "thinking...");
    appendTextBlock("claude", "World");

    const run = getVisibleRun("claude")!;
    expect(run.text).toBe("Hello World");
  });

  it("thinking은 모든 thought 블록의 합이다", () => {
    createRun("codex");
    appendThoughtBlock("codex", "A");
    appendTextBlock("codex", "response");
    appendThoughtBlock("codex", "B");

    const run = getVisibleRun("codex")!;
    expect(run.thinking).toBe("AB");
  });

  it("toolCalls는 모든 tool 블록의 목록이다", () => {
    createRun("gemini");
    upsertToolBlock("gemini", "tool1", "running");
    upsertToolBlock("gemini", "tool2", "completed");
    upsertToolBlock("gemini", "tool1", "completed");

    const run = getVisibleRun("gemini")!;
    expect(run.toolCalls).toHaveLength(2);
    expect(run.toolCalls[0].title).toBe("tool1");
    expect(run.toolCalls[0].status).toBe("completed");
    expect(run.toolCalls[1].title).toBe("tool2");
  });
});

describe("동시성 격리", () => {
  it("서로 다른 CLI의 run은 독립적이다", () => {
    createRun("claude");
    createRun("codex");

    appendTextBlock("claude", "claude answer");
    appendTextBlock("codex", "codex answer");

    expect(getVisibleRun("claude")!.text).toBe("claude answer");
    expect(getVisibleRun("codex")!.text).toBe("codex answer");
  });

  it("같은 CLI의 두 run은 서로 덮어쓰지 않는다", () => {
    const runId1 = createRun("claude");
    appendTextBlock("claude", "first response");

    createRun("claude");
    appendTextBlock("claude", "second response");

    // visible run은 두 번째 run
    expect(getVisibleRun("claude")!.text).toBe("second response");

    // 첫 번째 run의 데이터는 보존됨
    const old = getRunById(runId1)!;
    expect(old.text).toBe("first response");
  });
});

describe("visibleRunIdByCli 매핑", () => {
  it("getAllVisibleRuns는 등록된 carrier 순서로 반환한다", () => {
    createRun("gemini");
    createRun("claude");
    // codex는 생성하지 않음

    const runs = getAllVisibleRuns();
    expect(runs).toHaveLength(3);
    expect(runs[0]!.cli).toBe("claude");
    expect(runs[1]).toBeUndefined();
    expect(runs[2]!.cli).toBe("gemini");
  });

});

describe("finalizeRun", () => {
  it("status와 sessionId를 올바르게 설정한다", () => {
    createRun("claude");
    appendTextBlock("claude", "response text");

    finalizeRun("claude", "done", {
      sessionId: "sess-123",
    });

    const run = getVisibleRun("claude")!;
    expect(run.status).toBe("done");
    expect(run.sessionId).toBe("sess-123");
    expect(run.lastAgentStatus).toBe("done");
  });

  it("스트리밍 텍스트가 없으면 fallbackText를 사용한다", () => {
    createRun("codex");

    finalizeRun("codex", "done", {
      fallbackText: "SDK response",
    });

    const run = getVisibleRun("codex")!;
    expect(run.text).toBe("SDK response");
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].type).toBe("text");
  });

  it("스트리밍 텍스트가 있으면 fallbackText를 무시한다", () => {
    createRun("gemini");
    appendTextBlock("gemini", "streamed");

    finalizeRun("gemini", "done", {
      fallbackText: "SDK response",
    });

    const run = getVisibleRun("gemini")!;
    expect(run.text).toBe("streamed");
    expect(run.blocks).toHaveLength(1);
  });

  it("에러 상태를 올바르게 설정한다", () => {
    createRun("claude");

    finalizeRun("claude", "err", {
      error: "timeout",
      fallbackText: "Error: timeout",
    });

    const run = getVisibleRun("claude")!;
    expect(run.status).toBe("err");
    expect(run.error).toBe("timeout");
    expect(run.lastAgentStatus).toBe("error");
  });
});

describe("resetRuns", () => {
  it("모든 CLI에 대해 새 run을 생성한다", () => {
    createRun("claude");
    appendTextBlock("claude", "old data");

    resetRuns();

    const runs = getAllVisibleRuns();
    expect(runs[0]).toBeDefined();
    expect(runs[0]!.status).toBe("wait");
    expect(runs[0]!.blocks).toHaveLength(0);
    expect(runs[1]).toBeDefined(); // codex
    expect(runs[2]).toBeDefined(); // gemini
  });
});

describe("updateRunStatus", () => {
  it("AgentStatus에 따라 ColStatus를 매핑한다", () => {
    createRun("claude", "wait");

    updateRunStatus("claude", "connecting");
    expect(getVisibleRun("claude")!.status).toBe("conn");

    updateRunStatus("claude", "running");
    expect(getVisibleRun("claude")!.status).toBe("stream");
  });
});

describe("캐시 무효화", () => {
  it("블록 변경 후 파생 getter가 갱신된다", () => {
    createRun("claude");
    appendTextBlock("claude", "A");

    const run = getVisibleRun("claude")!;
    expect(run.text).toBe("A");

    appendTextBlock("claude", "B");
    // 같은 text 블록이라 병합됨
    expect(run.text).toBe("AB");
  });
});
