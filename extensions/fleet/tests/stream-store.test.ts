/**
 * stream-store 단위 테스트
 *
 * blocks를 canonical 데이터로 하는 스토어의 핵심 동작을 검증합니다.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CARRIER_FRAMEWORK_KEY } from "../shipyard/carrier/types.js";
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
} from "../bridge/streaming/stream-store.js";

// 각 테스트 전에 globalThis 상태 초기화
beforeEach(() => {
  (globalThis as any)["__pi_stream_store__"] = undefined;
  // carrier framework 상태를 테스트용으로 설정 (getRegisteredOrder 대응)
  (globalThis as any)[CARRIER_FRAMEWORK_KEY] = {
    modes: new Map(),
    registeredOrder: ["genesis", "sentinel", "vanguard"],
    statusUpdateCallbacks: [],
  };
});

describe("createRun", () => {
  it("새 run을 생성하고 visible로 설정한다", () => {
    const runId = createRun("genesis");
    expect(runId).toContain("genesis-");

    const run = getVisibleRun("genesis");
    expect(run).toBeDefined();
    expect(run!.cli).toBe("genesis");
    expect(run!.runId).toBe(runId);
    expect(run!.status).toBe("conn"); // 기본 initialStatus
  });

  it("같은 CLI에 두 번째 run을 생성하면 visible이 교체된다", () => {
    const runId1 = createRun("genesis");
    const runId2 = createRun("genesis");

    expect(runId1).not.toBe(runId2);

    const visible = getVisibleRun("genesis");
    expect(visible!.runId).toBe(runId2);

    // 이전 run은 runId로 여전히 접근 가능
    const old = getRunById(runId1);
    expect(old).toBeDefined();
    expect(old!.runId).toBe(runId1);
  });
});

describe("이벤트 순서 보존", () => {
  it("thought → tool → toolUpdate → text 순서로 blocks가 누적된다", () => {
    createRun("vanguard");

    appendThoughtBlock("vanguard", "분석 중...");
    upsertToolBlock("vanguard", "read_file", "running");
    upsertToolBlock("vanguard", "read_file", "completed");
    appendTextBlock("vanguard", "결과: ");
    appendTextBlock("vanguard", "성공했습니다.");

    const run = getVisibleRun("vanguard")!;
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
    createRun("genesis");

    appendTextBlock("genesis", "첫 응답");
    appendThoughtBlock("genesis", "생각 중");
    appendTextBlock("genesis", "두 번째 응답");

    const run = getVisibleRun("genesis")!;
    expect(run.blocks).toHaveLength(3);
    expect(run.blocks[0].type).toBe("text");
    expect(run.blocks[1].type).toBe("thought");
    expect(run.blocks[2].type).toBe("text");
  });
});

describe("파생 getter", () => {
  it("text는 모든 text 블록의 합이다", () => {
    createRun("genesis");
    appendTextBlock("genesis", "Hello ");
    appendThoughtBlock("genesis", "thinking...");
    appendTextBlock("genesis", "World");

    const run = getVisibleRun("genesis")!;
    expect(run.text).toBe("Hello World");
  });

  it("thinking은 모든 thought 블록의 합이다", () => {
    createRun("sentinel");
    appendThoughtBlock("sentinel", "A");
    appendTextBlock("sentinel", "response");
    appendThoughtBlock("sentinel", "B");

    const run = getVisibleRun("sentinel")!;
    expect(run.thinking).toBe("AB");
  });

  it("toolCalls는 모든 tool 블록의 목록이다", () => {
    createRun("vanguard");
    upsertToolBlock("vanguard", "tool1", "running");
    upsertToolBlock("vanguard", "tool2", "completed");
    upsertToolBlock("vanguard", "tool1", "completed");

    const run = getVisibleRun("vanguard")!;
    expect(run.toolCalls).toHaveLength(2);
    expect(run.toolCalls[0].title).toBe("tool1");
    expect(run.toolCalls[0].status).toBe("completed");
    expect(run.toolCalls[1].title).toBe("tool2");
  });
});

describe("동시성 격리", () => {
  it("서로 다른 CLI의 run은 독립적이다", () => {
    createRun("genesis");
    createRun("sentinel");

    appendTextBlock("genesis", "genesis answer");
    appendTextBlock("sentinel", "sentinel answer");

    expect(getVisibleRun("genesis")!.text).toBe("genesis answer");
    expect(getVisibleRun("sentinel")!.text).toBe("sentinel answer");
  });

  it("같은 CLI의 두 run은 서로 덮어쓰지 않는다", () => {
    const runId1 = createRun("genesis");
    appendTextBlock("genesis", "first response");

    createRun("genesis");
    appendTextBlock("genesis", "second response");

    // visible run은 두 번째 run
    expect(getVisibleRun("genesis")!.text).toBe("second response");

    // 첫 번째 run의 데이터는 보존됨
    const old = getRunById(runId1)!;
    expect(old.text).toBe("first response");
  });
});

describe("visibleRunIdByCli 매핑", () => {
  it("getAllVisibleRuns는 등록된 carrier 순서로 반환한다", () => {
    createRun("vanguard");
    createRun("genesis");
    // sentinel는 생성하지 않음

    const runs = getAllVisibleRuns();
    expect(runs).toHaveLength(3);
    expect(runs[0]!.cli).toBe("genesis");
    expect(runs[1]).toBeUndefined();
    expect(runs[2]!.cli).toBe("vanguard");
  });

});

describe("finalizeRun", () => {
  it("status와 sessionId를 올바르게 설정한다", () => {
    createRun("genesis");
    appendTextBlock("genesis", "response text");

    finalizeRun("genesis", "done", {
      sessionId: "sess-123",
    });

    const run = getVisibleRun("genesis")!;
    expect(run.status).toBe("done");
    expect(run.sessionId).toBe("sess-123");
    expect(run.lastAgentStatus).toBe("done");
  });

  it("스트리밍 텍스트가 없으면 fallbackText를 사용한다", () => {
    createRun("sentinel");

    finalizeRun("sentinel", "done", {
      fallbackText: "SDK response",
    });

    const run = getVisibleRun("sentinel")!;
    expect(run.text).toBe("SDK response");
    expect(run.blocks).toHaveLength(1);
    expect(run.blocks[0].type).toBe("text");
  });

  it("스트리밍 텍스트가 있으면 fallbackText를 무시한다", () => {
    createRun("vanguard");
    appendTextBlock("vanguard", "streamed");

    finalizeRun("vanguard", "done", {
      fallbackText: "SDK response",
    });

    const run = getVisibleRun("vanguard")!;
    expect(run.text).toBe("streamed");
    expect(run.blocks).toHaveLength(1);
  });

  it("에러 상태를 올바르게 설정한다", () => {
    createRun("genesis");

    finalizeRun("genesis", "err", {
      error: "timeout",
      fallbackText: "Error: timeout",
    });

    const run = getVisibleRun("genesis")!;
    expect(run.status).toBe("err");
    expect(run.error).toBe("timeout");
    expect(run.lastAgentStatus).toBe("error");
  });
});

describe("resetRuns", () => {
  it("모든 CLI에 대해 새 run을 생성한다", () => {
    createRun("genesis");
    appendTextBlock("genesis", "old data");

    resetRuns();

    const runs = getAllVisibleRuns();
    expect(runs[0]).toBeDefined();
    expect(runs[0]!.status).toBe("wait");
    expect(runs[0]!.blocks).toHaveLength(0);
    expect(runs[1]).toBeDefined(); // sentinel
    expect(runs[2]).toBeDefined(); // vanguard
  });
});

describe("updateRunStatus", () => {
  it("AgentStatus에 따라 ColStatus를 매핑한다", () => {
    createRun("genesis", "wait");

    updateRunStatus("genesis", "connecting");
    expect(getVisibleRun("genesis")!.status).toBe("conn");

    updateRunStatus("genesis", "running");
    expect(getVisibleRun("genesis")!.status).toBe("stream");
  });
});

describe("캐시 무효화", () => {
  it("블록 변경 후 파생 getter가 갱신된다", () => {
    createRun("genesis");
    appendTextBlock("genesis", "A");

    const run = getVisibleRun("genesis")!;
    expect(run.text).toBe("A");

    appendTextBlock("genesis", "B");
    // 같은 text 블록이라 병합됨
    expect(run.text).toBe("AB");
  });
});
