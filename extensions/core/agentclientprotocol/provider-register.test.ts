import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
}));

vi.mock("@sbluemin/unified-agent", () => ({
  getModelsRegistry: () => ({
    providers: {
      codex: {
        models: [{ modelId: "gpt-5.4", name: "GPT-5.4" }],
        reasoningEffort: {
          supported: true,
          levels: ["none", "low", "medium", "high", "xhigh"],
          default: "high",
        },
      },
    },
  }),
}));

vi.mock("./runtime.js", () => ({
  initRuntime: vi.fn(),
  onHostSessionChange: vi.fn(),
}));

vi.mock("./provider-stream.js", () => ({
  streamAcp: vi.fn(),
  cleanupAll: vi.fn(async () => {}),
  handleSessionStart: vi.fn(async () => {}),
}));

vi.mock("./thinking-level-patch.js", () => ({
  installAcpThinkingLevelPatch: vi.fn(),
  reconcileAcpThinkingLevel: vi.fn(),
}));

import registerAcpProvider from "./provider-register.js";
import { handleSessionStart } from "./provider-stream.js";
import { initRuntime, onHostSessionChange } from "./runtime.js";

describe("provider-register", () => {
  it("provider 자체가 Fleet session-map runtime을 초기화하고 session_start에서 PI session에 바인딩한다", async () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };

    registerAcpProvider(pi as any);

    expect(initRuntime).toHaveBeenCalledWith(path.join(os.homedir(), ".pi", "fleet"));

    const sessionStart = mockState.handlers.get("session_start");
    expect(sessionStart).toBeTruthy();

    sessionStart?.(
      { reason: "resume" },
      {
        model: { id: "GPT-5.4 (ACP)" },
        sessionManager: {
          getSessionId: () => "pi-session-resume",
        },
      },
    );

    await vi.waitFor(() => {
      expect(handleSessionStart).toHaveBeenCalledWith("resume", "pi-session-resume");
    });

    expect(onHostSessionChange).toHaveBeenCalledWith("pi-session-resume");
    expect(vi.mocked(onHostSessionChange).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(handleSessionStart).mock.invocationCallOrder[0]);
  });

  it("session_tree 이벤트도 provider runtime store를 활성 PI session에 바인딩한다", () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };

    registerAcpProvider(pi as any);

    const sessionTree = mockState.handlers.get("session_tree");
    expect(sessionTree).toBeTruthy();

    sessionTree?.(
      {},
      {
        sessionManager: {
          getSessionId: () => "pi-session-tree",
        },
      },
    );

    expect(onHostSessionChange).toHaveBeenCalledWith("pi-session-tree");
  });
});
