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
        name: "OpenAI Codex CLI",
        models: [{ modelId: "gpt-5.4", name: "GPT-5.4" }],
        reasoningEffort: {
          supported: true,
          levels: ["none", "low", "medium", "high", "xhigh"],
          default: "high",
        },
      },
    },
  }),
  CLI_BACKENDS: {
    codex: {
      supportsSessionClose: true,
      supportsSessionLoad: true,
      requiresModelAtSpawn: false,
      usesNpxBridge: false,
      defaultMaxTokens: 100_000,
    },
  },
}));

vi.mock("../../src/agent/provider-internal/session-runtime.js", () => ({
  initRuntime: vi.fn(),
  onHostSessionChange: vi.fn(),
}));

vi.mock("@sbluemin/fleet-core/services/log", () => ({
  getLogAPI: () => ({
    debug: vi.fn(),
    registerCategory: vi.fn(),
  }),
}));

vi.mock("../../src/agent/provider-internal/provider-stream.js", () => ({
  streamAcp: vi.fn(),
  cleanupAll: vi.fn(async () => {}),
  handleSessionStart: vi.fn(async () => {}),
}));

vi.mock("../../src/agent/provider-internal/thinking-level-patch.js", () => ({
  installAcpThinkingLevelPatch: vi.fn(),
  reconcileAcpThinkingLevel: vi.fn(),
}));

import registerProviderRuntime from "../../src/agent/provider-internal/provider-register.js";
import { handleSessionStart } from "../../src/agent/provider-internal/provider-stream.js";
import { initRuntime, onHostSessionChange } from "../../src/agent/provider-internal/session-runtime.js";

describe("provider register", () => {
  it("provider/model 등록 라벨을 Unified 표기로 노출한다", () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };

    registerProviderRuntime(pi as any);

    expect(pi.registerProvider).toHaveBeenCalledWith(
      "OpenAI Codex CLI",
      expect.objectContaining({
        baseUrl: "OpenAI Codex CLI",
        api: "OpenAI Codex CLI",
        models: [
          expect.objectContaining({
            id: "GPT-5.4 (Unified)",
            name: "GPT-5.4",
          }),
        ],
      }),
    );
  });

  it("provider 자체가 Fleet session-map runtime을 초기화하고 session_start에서 PI session에 바인딩한다", async () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };

    registerProviderRuntime(pi as any);

    expect(initRuntime).toHaveBeenCalledWith(path.join(os.homedir(), ".pi", "fleet"));

    const sessionStart = mockState.handlers.get("session_start");
    expect(sessionStart).toBeTruthy();

    sessionStart?.(
      { reason: "resume" },
      {
        model: { id: "GPT-5.4 (Unified)" },
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

    registerProviderRuntime(pi as any);

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
