import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeWithPool: vi.fn(),
}));

vi.mock("../../src/services/agent/dispatcher/executor.js", () => ({
  executeWithPool: mocks.executeWithPool,
}));

vi.mock("../../src/admiral/store/index.js", () => ({
  loadModels: () => ({
    genesis: { model: "gpt-test", effort: "medium", budgetTokens: 128 },
  }),
}));

import { createAgentRequestService } from "../../src/services/agent/dispatcher/request/service.js";
import type { AgentStreamingSink } from "../../src/public/agent-services.js";

beforeEach(() => {
  mocks.executeWithPool.mockReset();
});

describe("createAgentRequestService", () => {
  it("streams foreground requests through semantic sink events", async () => {
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
        toolCalls: [{ title: "Read", status: "done", timestamp: 1 }],
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
    expect(events).toContain("status:running");
    expect(events).toContain("thought:think");
    expect(events).toContain("tool:Read:done");
    expect(events).toContain("message:hello");
    expect(events.at(-1)).toBe("end:done");
    expect(result).toMatchObject({
      status: "done",
      responseText: "hello",
      sessionId: "session-1",
      thinking: "think",
    });
    expect(result.toolCalls).toEqual([{ title: "Read", status: "done" }]);
    expect(mocks.executeWithPool).toHaveBeenCalledWith(expect.objectContaining({
      carrierId: "genesis",
      cliType: "codex",
      cwd: "/tmp/project",
      model: "gpt-test",
      effort: "medium",
      budgetTokens: 128,
    }));
  });

  it("adds request correlation ids to foreground stream events and omits raw tool output", async () => {
    mocks.executeWithPool.mockImplementation(async (opts) => {
      opts.onToolCall?.("Read", "done", "secret raw", "tool-1");
      return {
        status: "done",
        responseText: "ok",
        thoughtText: "",
        toolCalls: [{ title: "Read", status: "done", rawOutput: "secret raw", timestamp: 1 }],
        error: undefined,
        connectionInfo: {},
        streamData: createStreamData("ok"),
      };
    });
    const seenRequestIds = new Set<string | undefined>();
    const toolEvents: unknown[] = [];
    const sink: AgentStreamingSink = {
      onAgentStreamEvent(event) {
        seenRequestIds.add(event.key.requestId);
        if (event.type === "tool") toolEvents.push(event);
      },
    };
    const service = createAgentRequestService({ streamingSink: sink });

    await service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "first",
      cwd: "/tmp/project",
    });
    await service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "second",
      cwd: "/tmp/project",
    });

    expect(seenRequestIds.size).toBe(2);
    expect([...seenRequestIds].every(Boolean)).toBe(true);
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents).toEqual([
      expect.not.objectContaining({ rawOutput: expect.anything() }),
      expect.not.objectContaining({ rawOutput: expect.anything() }),
    ]);
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
  });

  it("ends foreground requests with error reason and rethrows executor errors", async () => {
    mocks.executeWithPool.mockRejectedValue(new Error("boom"));
    const events: string[] = [];
    let endStreamData: unknown;
    const service = createAgentRequestService({
      streamingSink: {
        onAgentStreamEvent(event) {
          createRecordingSink(events).onAgentStreamEvent(event);
          if (event.type === "request_end") endStreamData = event.streamData;
        },
      },
    });

    await expect(service.run({
      cli: "codex",
      carrierId: "genesis",
      request: "fail",
      cwd: "/tmp/project",
    })).rejects.toThrow("boom");

    expect(events.at(-1)).toBe("end:error");
    expect(endStreamData).toMatchObject({
      text: "Error: boom",
      thinking: "",
      toolCalls: [],
      blocks: [{ type: "text", text: "Error: boom" }],
      lastStatus: "error",
    });
  });

  it("runs background requests without sink events while preserving executor result", async () => {
    mocks.executeWithPool.mockImplementation(async (opts) => {
      opts.onMessageChunk?.("background");
      opts.onToolCall?.("Write", "done", "raw", "tool-2");
      return {
        status: "done",
        responseText: "background",
        thoughtText: "",
        toolCalls: [{ title: "Write", status: "done", timestamp: 1 }],
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

  it("serializes async stream events before final end", async () => {
    let releaseFirstUpdate: (() => void) | undefined;
    const events: string[] = [];
    const sink: AgentStreamingSink = {
      async onAgentStreamEvent(event) {
        if (event.type === "message" && event.text === "first") {
          await new Promise<void>((resolve) => {
            releaseFirstUpdate = resolve;
            setTimeout(resolve, 0);
          });
        }
        if (event.type === "request_begin") events.push("begin");
        if (event.type === "message") events.push(`message:${event.text}`);
        if (event.type === "request_end") events.push(`end:${event.reason}`);
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
      "message:first",
      "message:second",
      "end:done",
    ]);
  });

  it("keeps successful request results when sink updates reject and still attempts end", async () => {
    const events: string[] = [];
    const sink: AgentStreamingSink = {
      async onAgentStreamEvent(event) {
        if (event.type === "request_begin") {
          events.push("begin");
          return;
        }
        if (event.type === "message") {
          events.push("message");
          throw new Error("sink update failed");
        }
        if (event.type === "request_end") events.push(`end:${event.reason}`);
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
    expect(events.filter((event) => event === "message").length).toBeGreaterThan(0);
  });
});

function createRecordingSink(events: string[]): AgentStreamingSink {
  return {
    onAgentStreamEvent(event) {
      if (event.type === "request_begin") events.push(`begin:${event.key.carrierId}`);
      if (event.type === "status") events.push(`status:${event.status}`);
      if (event.type === "thought") events.push(`thought:${event.text}`);
      if (event.type === "tool") events.push(`tool:${event.title}:${event.status}`);
      if (event.type === "message") events.push(`message:${event.text}`);
      if (event.type === "request_end") events.push(`end:${event.reason}`);
    },
  };
}

function createStreamData(text: string) {
  return {
    text,
    thinking: "",
    toolCalls: [],
    blocks: [{ type: "text" as const, text }],
    lastStatus: "done" as const,
  };
}
