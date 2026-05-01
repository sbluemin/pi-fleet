import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
}));

vi.mock("@sbluemin/unified-agent", () => ({
  UnifiedAgent: {
    build: mocks.build,
  },
  getReasoningEffortLevels: vi.fn(() => []),
  CLI_BACKENDS: {},
}));

import {
  executeWithPool,
  getClientPool,
  getSessionStore,
  initRuntime,
  onHostSessionChange,
} from "../../src/admiral/_shared/agent-runtime.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-agent-runtime-"));
  getClientPool().clear();
  mocks.build.mockReset();
});

afterEach(() => {
  getClientPool().clear();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("admiral agent runtime executeWithPool", () => {
  it("신규 carrier 요청을 provider client에 연결하고 정규화 결과를 반환한다", async () => {
    const client = createClientMock();
    mocks.build.mockResolvedValueOnce(client);
    initRuntime(tmpDir);
    onHostSessionChange("pi-session-1");

    const statuses: string[] = [];
    const messages: string[] = [];
    const thoughts: string[] = [];
    const tools: Array<[string, string, string?, string?]> = [];

    const result = await executeWithPool({
      cliType: "codex",
      carrierId: "genesis",
      request: "work",
      cwd: "/tmp/project",
      connectSystemPrompt: "system",
      onStatusChange: (status) => statuses.push(status),
      onMessageChunk: (text) => messages.push(text),
      onThoughtChunk: (text) => thoughts.push(text),
      onToolCall: (...args) => tools.push(args),
    });

    expect(mocks.build).toHaveBeenCalledWith({ cli: "codex" });
    expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({
      cli: "codex",
      cwd: "/tmp/project",
      systemPrompt: "system",
      autoApprove: true,
    }));
    expect(client.sendMessage).toHaveBeenCalledWith("work");
    expect(result).toMatchObject({
      status: "done",
      responseText: "hello",
      thoughtText: "think",
      connectionInfo: { protocol: "acp", sessionId: "session-1" },
    });
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        title: "Read",
        status: "done",
        rawOutput: "file content",
        toolCallId: "tool-1",
      }),
    ]);
    expect(result.streamData).toMatchObject({
      text: "hello",
      thinking: "think",
      lastStatus: "done",
    });
    expect(statuses).toEqual(["connecting", "running", "done"]);
    expect(messages).toEqual(["hello"]);
    expect(thoughts).toEqual(["think"]);
    expect(tools).toEqual([["Read", "done", "file content", "tool-1"]]);
  });

  it("저장된 dead session은 clear 후 같은 요청을 fresh session으로 재시도한다", async () => {
    const staleConnectArgs: any[] = [];
    const staleClient = createClientMock({
      connect: vi.fn(async (opts: any) => {
        staleConnectArgs.push({ ...opts });
        throw new Error("session not found: stale-session");
      }),
    });
    const freshClient = createClientMock({
      sessionId: "fresh-session",
      responseText: "fresh",
    });
    mocks.build
      .mockResolvedValueOnce(staleClient)
      .mockResolvedValueOnce(freshClient);
    initRuntime(tmpDir);
    onHostSessionChange("pi-session-2");

    const store = getSessionStore();
    store.set("genesis", "stale-session");
    expect(store.get("genesis")).toBe("stale-session");

    const result = await executeWithPool({
      cliType: "codex",
      carrierId: "genesis",
      request: "work",
      cwd: "/tmp/project",
    });

    expect(staleConnectArgs[0]).toEqual(expect.objectContaining({
      sessionId: "stale-session",
    }));
    expect(freshClient.connect).toHaveBeenCalledWith(expect.not.objectContaining({
      sessionId: expect.any(String),
    }));
    expect(freshClient.sendMessage).toHaveBeenCalledWith("work");
    expect(result).toMatchObject({
      status: "done",
      responseText: "fresh",
      connectionInfo: { sessionId: "fresh-session" },
    });
    expect(store.get("genesis")).toBe("fresh-session");
  });
});

function createClientMock(overrides: Record<string, any> = {}) {
  const handlers = new Map<string, Set<(...args: any[]) => void>>();
  const sessionId = overrides.sessionId ?? "session-1";
  const responseText = overrides.responseText ?? "hello";

  const client = {
    connect: vi.fn(async () => ({
      protocol: "acp",
      session: { sessionId },
    })),
    sendMessage: vi.fn(async () => {
      emit("thoughtChunk", "think");
      emit("toolCall", "Read", "done", sessionId, {
        toolCallId: "tool-1",
        content: [{ type: "content", content: { type: "text", text: "file content" } }],
      });
      emit("messageChunk", responseText);
    }),
    cancelPrompt: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    removeAllListeners: vi.fn(() => handlers.clear()),
    getConnectionInfo: vi.fn(() => ({ state: "disconnected", protocol: "acp", sessionId })),
    getCurrentSystemPrompt: vi.fn(() => ""),
    setConfigOption: vi.fn(async () => {}),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const eventHandlers = handlers.get(event) ?? new Set();
      eventHandlers.add(handler);
      handlers.set(event, eventHandlers);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    ...overrides,
  };

  function emit(event: string, ...args: any[]) {
    for (const handler of handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  return client;
}
