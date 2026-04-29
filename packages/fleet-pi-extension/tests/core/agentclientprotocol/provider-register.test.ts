import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@sbluemin/fleet-core/agent/runtime", () => ({
  initRuntime: vi.fn(),
  onHostSessionChange: vi.fn(),
}));

vi.mock("../../../src/session-bridge/agentclientprotocol/provider-stream.js", () => ({
  streamAcp: vi.fn(),
  cleanupAll: vi.fn(async () => {}),
  handleSessionStart: vi.fn(async () => {}),
}));

vi.mock("../../../src/session-bridge/agentclientprotocol/thinking-level-patch.js", () => ({
  installAcpThinkingLevelPatch: vi.fn(),
  reconcileAcpThinkingLevel: vi.fn(),
}));

import registerAcpProvider from "../../../src/session-bridge/agentclientprotocol/provider-register.js";
import { ACTIVE_STREAM_KEY } from "@sbluemin/fleet-core/agent/provider-types";
import { cleanupAll, handleSessionStart, streamAcp } from "../../../src/session-bridge/agentclientprotocol/provider-stream.js";
import { initRuntime, onHostSessionChange } from "@sbluemin/fleet-core/agent/runtime";

describe("provider-register", () => {
  beforeEach(() => {
    mockState.handlers.clear();
    vi.clearAllMocks();
    delete (globalThis as Record<symbol, unknown>)[ACTIVE_STREAM_KEY];
  });

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

  it("session_start 전환 정리를 await해 새 세션 Fleet 상태와 레이스하지 않는다", async () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };
    let releaseStart!: () => void;
    const startPromise = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    vi.mocked(handleSessionStart).mockImplementationOnce(async () => startPromise);

    registerAcpProvider(pi as any);

    const sessionStart = mockState.handlers.get("session_start");
    let settled = false;
    const result = Promise.resolve(sessionStart?.(
      { reason: "new" },
      {
        model: { id: "GPT-5.4 (ACP)" },
        sessionManager: {
          getSessionId: () => "pi-session-new",
        },
      },
    )).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    releaseStart();
    await result;
    expect(settled).toBe(true);
  });

  it("session_shutdown 정리를 await해 이전 세션 cleanup이 새 세션 registry를 늦게 지우지 않는다", async () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };
    let releaseCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.mocked(cleanupAll).mockImplementationOnce(async () => cleanupPromise);

    registerAcpProvider(pi as any);

    const sessionShutdown = mockState.handlers.get("session_shutdown");
    let settled = false;
    const result = Promise.resolve(sessionShutdown?.({}, {})).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    releaseCleanup();
    await result;
    expect(settled).toBe(true);
  });

  it("pending shutdown cleanup이 reload로 등록된 새 ACTIVE_STREAM_KEY 소유권을 지우지 않는다", async () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };
    let releaseCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.mocked(cleanupAll).mockImplementationOnce(async () => cleanupPromise);

    registerAcpProvider(pi as any);

    const sessionShutdown = mockState.handlers.get("session_shutdown");
    const result = Promise.resolve(sessionShutdown?.({}, {}));
    const reloadedStream = vi.fn();
    (globalThis as Record<symbol, unknown>)[ACTIVE_STREAM_KEY] = reloadedStream;

    releaseCleanup();
    await result;

    expect((globalThis as Record<symbol, unknown>)[ACTIVE_STREAM_KEY]).toBe(reloadedStream);
    expect((globalThis as Record<symbol, unknown>)[ACTIVE_STREAM_KEY]).not.toBe(streamAcp);
  });

  it("lifecycle task rejection 이후에도 다음 session_start 작업을 실행한다", async () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };
    vi.mocked(cleanupAll).mockRejectedValueOnce(new Error("cleanup failed"));

    registerAcpProvider(pi as any);

    const sessionShutdown = mockState.handlers.get("session_shutdown");
    const sessionStart = mockState.handlers.get("session_start");

    await sessionShutdown?.({}, {});
    await sessionStart?.(
      { reason: "new" },
      {
        model: { id: "GPT-5.4 (ACP)" },
        sessionManager: {
          getSessionId: () => "pi-session-after-error",
        },
      },
    );

    expect(handleSessionStart).toHaveBeenCalledWith("new", "pi-session-after-error");
  });

  it("host가 handler Promise를 await하지 않아도 session_shutdown cleanup 후 session_start를 실행한다", async () => {
    const pi = {
      on: vi.fn((event: string, handler: Function) => {
        mockState.handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
    };
    let releaseCleanup!: () => void;
    const cleanupPromise = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    vi.mocked(cleanupAll).mockImplementationOnce(async () => cleanupPromise);

    registerAcpProvider(pi as any);

    const sessionShutdown = mockState.handlers.get("session_shutdown");
    const sessionStart = mockState.handlers.get("session_start");

    sessionShutdown?.({}, {});
    sessionStart?.(
      { reason: "new" },
      {
        model: { id: "GPT-5.4 (ACP)" },
        sessionManager: {
          getSessionId: () => "pi-session-after-shutdown",
        },
      },
    );

    await Promise.resolve();
    expect(cleanupAll).toHaveBeenCalledTimes(1);
    expect(handleSessionStart).not.toHaveBeenCalled();

    releaseCleanup();
    await vi.waitFor(() => {
      expect(handleSessionStart).toHaveBeenCalledWith("new", "pi-session-after-shutdown");
    });
    expect(vi.mocked(cleanupAll).mock.invocationCallOrder[0])
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
