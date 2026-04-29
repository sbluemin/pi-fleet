import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeWithPool: vi.fn(),
}));

vi.mock("../../src/agent/executor.js", () => ({
  executeWithPool: mocks.executeWithPool,
}));

vi.mock("../../src/store/index.js", () => ({
  loadModels: () => ({
    genesis: { model: "gpt-test", effort: "medium", budgetTokens: 128 },
  }),
}));

import { createAgentRequestService } from "../../src/agent/request/service.js";
import { getVisibleRun, resetRuns } from "../../src/bridge/streaming/index.js";
import type { AgentStreamingSink } from "../../src/public/streaming-sink.js";

beforeEach(() => {
  mocks.executeWithPool.mockReset();
  resetRuns(["genesis"]);
});

describe("createAgentRequestService", () => {
  it("streams foreground requests through the sink and returns collected data", async () => {
    mocks.executeWithPool.mockImplementation(async (opts) => {
      opts.onStatusChange?.("running");
      opts.onThoughtChunk?.("think");
      opts.onToolCall?.("Read", "running", "raw", "tool-1");
      opts.onMessageChunk?.("hello");
      opts.onToolCall?.("Read", "done", "raw", "tool-1");
      return {
        status: "done",
        responseText: "hello",
        thoughtText: "think",
        toolCalls: [],
        error: undefined,
        connectionInfo: { sessionId: "session-1" },
      };
    });
    const events: string[] = [];
    const sink = createRecordingSink(events);
    const service = createAgentRequestService({ streamingSink: sink });

    const result = await service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "work",
      cwd: "/tmp/project",
    });

    expect(events[0]).toBe("begin:genesis");
    expect(events.some((event) => event.startsWith("update:stream"))).toBe(true);
    expect(events.at(-1)).toBe("end:done");
    expect(result).toMatchObject({
      status: "done",
      responseText: "hello",
      sessionId: "session-1",
      thinking: "think",
    });
    expect(result.toolCalls).toEqual([{ title: "Read", status: "done" }]);
    expect(result.blocks).toEqual([
      { type: "thought", text: "think" },
      { type: "tool", title: "Read", status: "done", toolCallId: "tool-1" },
      { type: "text", text: "hello" },
    ]);
    expect(mocks.executeWithPool).toHaveBeenCalledWith(expect.objectContaining({
      carrierId: "genesis",
      cliType: "codex",
      cwd: "/tmp/project",
      model: "gpt-test",
      effort: "medium",
      budgetTokens: 128,
    }));
  });

  it("ends foreground requests with aborted reason", async () => {
    mocks.executeWithPool.mockResolvedValue({
      status: "aborted",
      responseText: "",
      thoughtText: "",
      toolCalls: [],
      error: undefined,
      connectionInfo: {},
    });
    const events: string[] = [];
    const service = createAgentRequestService({ streamingSink: createRecordingSink(events) });

    const result = await service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "stop",
      cwd: "/tmp/project",
    });

    expect(result.status).toBe("aborted");
    expect(events.at(-1)).toBe("end:aborted");
    expect(getVisibleRun("genesis")?.text).toBe("Aborted.");
  });

  it("ends foreground requests with error reason and rethrows executor errors", async () => {
    mocks.executeWithPool.mockRejectedValue(new Error("boom"));
    const events: string[] = [];
    const service = createAgentRequestService({ streamingSink: createRecordingSink(events) });

    await expect(service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "fail",
      cwd: "/tmp/project",
    })).rejects.toThrow("boom");

    expect(events.at(-1)).toBe("end:error");
    expect(getVisibleRun("genesis")?.error).toBe("boom");
  });

  it("runs background requests without begin/end while preserving collected result", async () => {
    mocks.executeWithPool.mockImplementation(async (opts) => {
      opts.onMessageChunk?.("background");
      opts.onToolCall?.("Write", "done", "raw", "tool-2");
      return {
        status: "done",
        responseText: "background",
        thoughtText: "",
        toolCalls: [],
        error: undefined,
        connectionInfo: { sessionId: "session-bg" },
      };
    });
    const events: string[] = [];
    const service = createAgentRequestService({ streamingSink: createRecordingSink(events) });

    const result = await service.runBackground({
      cli: "codex",
      carrierId: "genesis",
      request: "background",
      cwd: "/tmp/project",
    });

    expect(events).toEqual([]);
    expect(result.status).toBe("done");
    expect(result.responseText).toBe("background");
    expect(result.toolCalls).toEqual([{ title: "Write", status: "done" }]);
  });

  it("serializes async column updates before final end", async () => {
    let releaseFirstUpdate: (() => void) | undefined;
    const events: string[] = [];
    const sink: AgentStreamingSink = {
      onColumnBegin() {
        events.push("begin");
      },
      async onColumnUpdate(_key, update) {
        const text = update.text ?? update.status ?? "";
        if (text === "first") {
          await new Promise<void>((resolve) => {
            releaseFirstUpdate = resolve;
            setTimeout(resolve, 0);
          });
        }
        events.push(`update:${text}`);
      },
      onColumnEnd(_key, reason) {
        events.push(`end:${reason}`);
      },
    };
    mocks.executeWithPool.mockImplementation(async (opts) => {
      opts.onMessageChunk?.("first");
      opts.onMessageChunk?.("second");
      releaseFirstUpdate?.();
      return {
        status: "done",
        responseText: "firstsecond",
        thoughtText: "",
        toolCalls: [],
        error: undefined,
        connectionInfo: { sessionId: "session-ordered" },
      };
    });
    const service = createAgentRequestService({ streamingSink: sink });

    await service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "ordered",
      cwd: "/tmp/project",
    });

    expect(events).toEqual([
      "begin",
      "update:first",
      "update:firstsecond",
      "update:firstsecond",
      "end:done",
    ]);
  });

  it("keeps successful request results when sink updates reject and still attempts end", async () => {
    const events: string[] = [];
    const sink: AgentStreamingSink = {
      onColumnBegin() {
        events.push("begin");
      },
      async onColumnUpdate() {
        events.push("update");
        throw new Error("sink update failed");
      },
      onColumnEnd(_key, reason) {
        events.push(`end:${reason}`);
      },
    };
    mocks.executeWithPool.mockImplementation(async (opts) => {
      opts.onMessageChunk?.("hello");
      return {
        status: "done",
        responseText: "hello",
        thoughtText: "",
        toolCalls: [],
        error: undefined,
        connectionInfo: { sessionId: "session-sink-fail" },
      };
    });
    const service = createAgentRequestService({ streamingSink: sink });

    const result = await service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "sink rejection",
      cwd: "/tmp/project",
    });

    expect(result.status).toBe("done");
    expect(result.responseText).toBe("hello");
    expect(events.at(-1)).toBe("end:done");
    expect(events.filter((event) => event === "update").length).toBeGreaterThan(0);
  });
});

function createRecordingSink(events: string[]): AgentStreamingSink {
  return {
    onColumnBegin({ carrierId }) {
      events.push(`begin:${carrierId}`);
    },
    onColumnUpdate(_key, update) {
      events.push(`update:${update.status ?? "unknown"}`);
    },
    onColumnEnd(_key, reason) {
      events.push(`end:${reason}`);
    },
  };
}
