import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const client = {
    on: vi.fn(),
    off: vi.fn(),
    sendMessage: vi.fn(() => new Promise<void>(() => {})),
    cancelPrompt: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };

  return {
    client,
    acceptanceCalls: [] as Array<[string, boolean]>,
  };
});

vi.mock("@mariozechner/pi-ai", () => ({
  createAssistantMessageEventStream: () => ({
    push: vi.fn(),
    end: vi.fn(),
  }),
}));

vi.mock("@sbluemin/unified-agent", () => ({
  UnifiedAgentClient: class {},
}));

vi.mock("./executor.js", () => ({
  acquireSession: vi.fn(async () => ({
    client: mockState.client,
    sessionId: "acp-session-1",
    connectionInfo: { sessionId: "acp-session-1" },
    release: vi.fn(),
  })),
  releaseSession: vi.fn(),
}));

vi.mock("./provider-events.js", () => ({
  createEventMapper: vi.fn(() => {
    const output: any = {
      role: "assistant",
      content: [],
      stopReason: "stop",
      timestamp: Date.now(),
    };

    return {
      stream: { push: vi.fn(), end: vi.fn() },
      output,
      listeners: {
        onMessageChunk: vi.fn(),
        onThoughtChunk: vi.fn(),
        onToolCall: vi.fn(),
        onToolCallUpdate: vi.fn(),
        onPromptComplete: vi.fn(),
        onError: vi.fn(),
        onExit: vi.fn(),
      },
      finishDone: vi.fn(() => {
        output.stopReason = "stop";
      }),
      finishWithError: vi.fn((reason: "aborted" | "error", message: string) => {
        output.stopReason = reason;
        output.errorMessage = message;
      }),
      setTargetSessionId: vi.fn(),
      setPiToolNames: vi.fn(),
      emitMcpToolCall: vi.fn((_toolName: string, _args: Record<string, unknown>, toolCallId: string) => {
        output.stopReason = "toolUse";
        output.content.push({ type: "toolCall", id: toolCallId });
        return true;
      }),
    };
  }),
}));

vi.mock("../log/bridge.js", () => ({
  getLogAPI: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("./provider-mcp.js", () => ({
  startMcpServer: vi.fn(async () => "http://127.0.0.1/test"),
  stopMcpServer: vi.fn(async () => {}),
  resolveNextToolCall: vi.fn(),
  clearPendingForSession: vi.fn(),
  setOnToolCallArrived: vi.fn(),
  setToolCallAcceptance: vi.fn((token: string, accepting: boolean) => {
    mockState.acceptanceCalls.push([token, accepting]);
  }),
}));

vi.mock("./provider-tools.js", () => ({
  registerToolsForSession: vi.fn(),
  removeToolsForSession: vi.fn(),
  clearAllTools: vi.fn(),
  computeToolHash: vi.fn(() => "tool-hash"),
  getToolNamesForSession: vi.fn(() => new Set(["custom-tool"])),
}));

import { streamAcp } from "./provider-stream.js";
import { GLOBAL_STATE_KEY, type AcpProviderState, type AcpSessionState } from "./provider-types.js";

describe("provider-stream", () => {
  afterEach(() => {
    mockState.client.on.mockClear();
    mockState.client.off.mockClear();
    mockState.client.sendMessage.mockClear();
    mockState.acceptanceCalls.length = 0;
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_STATE_KEY];
  });

  it("toolResult 이후 즉시 다음 toolUse로 끊겨도 listener와 abort cleanup을 실행한다", async () => {
    const signal = new AbortController().signal;
    const removeEventListenerSpy = vi.spyOn(signal, "removeEventListener");

    const session: AcpSessionState = {
      sessionKey: "acp:codex:session:pi:pi-turn",
      scopeKey: "session:pi:pi-turn",
      client: mockState.client as any,
      sessionId: "acp-session-1",
      cwd: "/tmp/pi-fleet",
      lastSystemPromptHash: "hash",
      cli: "codex",
      firstPromptSent: true,
      currentModel: "gpt-5.4",
      mcpSessionToken: "token-1",
      toolHash: "tool-hash",
      turnActive: true,
      pendingToolCalls: [
        { toolCallId: "call-1", toolName: "custom-tool", args: {}, emitted: true },
        { toolCallId: "call-2", toolName: "custom-tool", args: { next: true }, emitted: false },
      ],
      pendingToolCallNotifier: null,
    };

    const providerState: AcpProviderState = {
      sessions: new Map([[session.sessionKey, session]]),
      sessionKeysByScope: new Map([[session.scopeKey, new Set([session.sessionKey])]]),
      toolCallToSessionKey: new Map([
        ["call-1", session.sessionKey],
        ["call-2", session.sessionKey],
      ]),
    };
    (globalThis as Record<symbol, unknown>)[GLOBAL_STATE_KEY] = providerState;

    streamAcp(
      { id: "acp:codex:gpt-5.4" } as any,
      {
        systemPrompt: "system",
        messages: [
          {
            role: "toolResult",
            content: "done",
            toolCallId: "call-1",
          } as any,
        ],
      } as any,
      {
        cwd: "/tmp/pi-fleet",
        sessionId: "pi-turn",
        signal,
      } as any,
    );

    await vi.waitFor(() => {
      expect(mockState.client.off).toHaveBeenCalled();
    });

    expect(mockState.client.off).toHaveBeenCalledTimes(7);
    expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(session.pendingToolCallNotifier).toBeNull();
    expect(mockState.acceptanceCalls).toContainEqual(["token-1", true]);
    expect(mockState.acceptanceCalls).toContainEqual(["token-1", false]);
  });
});
