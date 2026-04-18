import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  type MockConnectionInfo = {
    state?: string;
    protocol?: string;
    sessionId?: string;
  };

  type MockClientPlan = {
    connectionInfo?: MockConnectionInfo;
    connectResults?: Array<{ protocol: string; session?: { sessionId?: string; models?: string[] } }>;
    connectErrors?: unknown[];
    sendMessageImpl?: () => Promise<void>;
    setConfigOptionImpl?: (option: string, value: string) => Promise<void>;
    currentSystemPrompt?: string | null;
  };

  class MockUnifiedAgentClient {
    connectionInfo: MockConnectionInfo;
    connectResults: Array<{ protocol: string; session?: { sessionId?: string; models?: string[] } }>;
    connectErrors: unknown[];
    currentSystemPrompt: string | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    cancelPrompt: ReturnType<typeof vi.fn>;
    setConfigOption: ReturnType<typeof vi.fn>;
    getConnectionInfo: ReturnType<typeof vi.fn>;
    getCurrentSystemPrompt: ReturnType<typeof vi.fn>;

    constructor() {
      const plan = mockState.clientPlans.shift() ?? {};
      this.connectionInfo = {
        state: "disconnected",
        protocol: undefined,
        sessionId: undefined,
        ...plan.connectionInfo,
      };
      this.connectResults = [...(plan.connectResults ?? [{
        protocol: "mcp",
        session: { sessionId: "session-1", models: ["gpt-5.4"] },
      }])];
      this.connectErrors = [...(plan.connectErrors ?? [])];
      this.currentSystemPrompt = plan.currentSystemPrompt ?? null;

      this.connect = vi.fn(async () => {
        const nextError = this.connectErrors.shift();
        if (nextError !== undefined) {
          throw nextError;
        }
        const result = this.connectResults.shift() ?? {
          protocol: "mcp",
          session: { sessionId: "session-1", models: ["gpt-5.4"] },
        };
        this.connectionInfo = {
          ...this.connectionInfo,
          state: "ready",
          protocol: result.protocol,
          sessionId: result.session?.sessionId,
        };
        return result;
      });
      this.disconnect = vi.fn(async () => {
        this.connectionInfo = {
          ...this.connectionInfo,
          state: "disconnected",
        };
      });
      this.removeAllListeners = vi.fn();
      this.on = vi.fn();
      this.off = vi.fn();
      this.sendMessage = vi.fn(plan.sendMessageImpl ?? (async () => {}));
      this.cancelPrompt = vi.fn(async () => {});
      this.setConfigOption = vi.fn(plan.setConfigOptionImpl ?? (async () => {}));
      this.getConnectionInfo = vi.fn(() => this.connectionInfo);
      this.getCurrentSystemPrompt = vi.fn(() => this.currentSystemPrompt);

      mockState.instances.push(this);
    }
  }

  return {
    MockUnifiedAgentClient,
    instances: [] as MockUnifiedAgentClient[],
    clientPlans: [] as MockClientPlan[],
    pool: new Map<string, { client: MockUnifiedAgentClient; busy: boolean; sessionId?: string }>(),
    sessionStoreState: {} as Record<string, string | undefined>,
    launchConfigs: new Map<string, { modelId: string; effort?: string; budgetTokens?: number }>(),
    systemPrompt: null as string | null,
    reasoningEffortLevels: ["low", "medium", "high"] as string[] | null,
  };
});

vi.mock("@sbluemin/unified-agent", () => ({
  UnifiedAgentClient: mockState.MockUnifiedAgentClient,
  getReasoningEffortLevels: vi.fn((cli: string) => {
    void cli;
    return mockState.reasoningEffortLevels;
  }),
}));

vi.mock("./pool.js", () => ({
  getClientPool: vi.fn(() => mockState.pool),
  isClientAlive: vi.fn((client: { getConnectionInfo: () => { state?: string } }) => {
    const info = client.getConnectionInfo();
    return info.state === "ready" || info.state === "connected";
  }),
  disconnectClient: vi.fn(async (key: string, expectedClient?: unknown) => {
    const current = mockState.pool.get(key);
    if (!current) return false;
    if (expectedClient && current.client !== expectedClient) return false;
    mockState.pool.delete(key);
    await current.client.disconnect();
    current.client.removeAllListeners();
    return true;
  }),
}));

vi.mock("./runtime.js", () => ({
  getSessionStore: vi.fn(() => ({
    restore: vi.fn(),
    get: vi.fn((key: string) => mockState.sessionStoreState[key]),
    set: vi.fn((key: string, value: string) => {
      mockState.sessionStoreState[key] = value;
    }),
    clear: vi.fn((key: string) => {
      delete mockState.sessionStoreState[key];
    }),
    getAll: vi.fn(() => ({ ...mockState.sessionStoreState })),
  })),
}));

vi.mock("./provider-types.js", () => ({
  buildModelId: vi.fn((cli: string, model: string) => `acp:${cli}:${model}`),
  getCliSystemPrompt: vi.fn(() => mockState.systemPrompt),
  setSessionLaunchConfig: vi.fn((key: string, config: { modelId: string; effort?: string; budgetTokens?: number }) => {
    const previous = mockState.launchConfigs.get(key);
    mockState.launchConfigs.set(key, {
      ...previous,
      ...config,
    });
  }),
  getSessionLaunchConfig: vi.fn((key: string) => mockState.launchConfigs.get(key)),
}));

import { acquireSession, executeOneShot, executeWithPool } from "./executor.js";
import { getSessionLaunchConfig, setSessionLaunchConfig } from "./provider-types.js";

describe("executor", () => {
  beforeEach(() => {
    mockState.instances.length = 0;
    mockState.clientPlans.length = 0;
    mockState.pool.clear();
    mockState.launchConfigs.clear();
    mockState.sessionStoreState = {};
    mockState.systemPrompt = null;
    mockState.reasoningEffortLevels = ["low", "medium", "high"];
    vi.restoreAllMocks();
  });

  it("executeWithPool 신규 연결에서 미지원 CLI면 reasoning_effort를 건너뛰고 로그도 남기지 않는다", async () => {
    mockState.reasoningEffortLevels = null;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await executeWithPool({
      carrierId: "carrier-1",
      cliType: "codex",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      effort: "high",
    } as any);

    const client = mockState.instances[0];
    expect(client.setConfigOption).not.toHaveBeenCalledWith("reasoning_effort", "high");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("executeWithPool 기존 연결 재사용에서 explicit effort가 있으면 적용한다", async () => {
    const client = new mockState.MockUnifiedAgentClient();
    client.connectionInfo = { state: "ready", protocol: "mcp", sessionId: "existing-1" };
    mockState.pool.set("carrier-2", { client, busy: false, sessionId: "existing-1" });

    await executeWithPool({
      carrierId: "carrier-2",
      cliType: "codex",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      effort: "medium",
    } as any);

    expect(client.setConfigOption).toHaveBeenCalledWith("reasoning_effort", "medium");
  });

  it("executeOneShot에서 설정 적용 실패 시 console.warn을 남긴다", async () => {
    mockState.clientPlans.push({
      setConfigOptionImpl: async (option: string) => {
        if (option === "reasoning_effort") {
          throw new Error("boom");
        }
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await executeOneShot({
      carrierId: "oneshot",
      cliType: "codex",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      effort: "high",
    } as any);

    expect(warnSpy).toHaveBeenCalledWith(
      "[acp] setConfigOption 실패 (cli=codex, option=reasoning_effort)",
      expect.any(Error),
    );
  });

  it("acquireSession 신규 연결에서 opts.effort가 falsy면 sticky로 setConfigOption을 호출하지 않는다", async () => {
    const acquired = await acquireSession({
      key: "session-new",
      cliType: "codex",
      cwd: "/tmp/pi-fleet",
      model: "gpt-5.4",
    });

    const client = mockState.instances[0];
    expect(client.setConfigOption).not.toHaveBeenCalled();
    acquired.release();
  });

  it("acquireSession fresh reconnect에서 보존된 launch metadata effort를 자동 재적용한다", async () => {
    setSessionLaunchConfig("session-reconnect", {
      modelId: "acp:codex:gpt-5.4",
      effort: "high",
    });
    mockState.sessionStoreState["session-reconnect"] = "saved-session";
    mockState.clientPlans.push({
      connectErrors: [new Error("resume failed")],
      connectResults: [{
        protocol: "mcp",
        session: { sessionId: "fresh-session", models: ["gpt-5.4"] },
      }],
    });

    const acquired = await acquireSession({
      key: "session-reconnect",
      cliType: "codex",
      cwd: "/tmp/pi-fleet",
      model: "gpt-5.4",
    });

    const client = mockState.instances[mockState.instances.length - 1];
    expect(client.setConfigOption).toHaveBeenCalledWith("reasoning_effort", "high");
    acquired.release();
  });

  it("setSessionLaunchConfig는 미지정 값을 유지하고 명시 값만 갱신한다", async () => {
    const first = await acquireSession({
      key: "session-launch",
      cliType: "codex",
      cwd: "/tmp/pi-fleet",
      model: "gpt-5.4",
      effort: "medium",
      budgetTokens: 2048,
    });
    first.release();

    const second = await acquireSession({
      key: "session-launch",
      cliType: "codex",
      cwd: "/tmp/pi-fleet",
      model: "gpt-5.4",
    });
    second.release();

    expect(getSessionLaunchConfig("session-launch")).toEqual({
      modelId: "acp:codex:gpt-5.4",
      effort: "medium",
      budgetTokens: 2048,
    });

    const third = await acquireSession({
      key: "session-launch",
      cliType: "codex",
      cwd: "/tmp/pi-fleet",
      model: "gpt-5.4",
      effort: "high",
    });
    third.release();

    expect(getSessionLaunchConfig("session-launch")).toEqual({
      modelId: "acp:codex:gpt-5.4",
      effort: "high",
      budgetTokens: 2048,
    });
  });
});
