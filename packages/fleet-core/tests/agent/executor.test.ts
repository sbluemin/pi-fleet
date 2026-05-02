import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
    launchConfigs: new Map<string, { modelId: string; effort?: string }>(),
    systemPrompt: null as string | null,
    reasoningEffortLevels: ["low", "medium", "high"] as string[] | null,
  };
});

vi.mock("@sbluemin/unified-agent", () => ({
  UnifiedAgent: {
    build: vi.fn(async () => new mockState.MockUnifiedAgentClient()),
    createClient: vi.fn(() => new mockState.MockUnifiedAgentClient()),
  },
  getReasoningEffortLevels: vi.fn((cli: string) => {
    void cli;
    return mockState.reasoningEffortLevels;
  }),
  CLI_BACKENDS: {},
}));

vi.mock("../../src/admiral/_shared/agent-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admiral/_shared/agent-runtime.js")>();
  return {
    ...actual,
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
      await (current.client.disconnect as () => Promise<void>)();
      (current.client.removeAllListeners as () => void)();
      return true;
    }),
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
    buildModelId: vi.fn((cli: string, model: string) => `acp:${cli}:${model}`),
    setSessionLaunchConfig: vi.fn((key: string, config: { modelId: string; effort?: string }) => {
      const previous = mockState.launchConfigs.get(key);
      mockState.launchConfigs.set(key, {
        ...previous,
        ...config,
      });
    }),
    getSessionLaunchConfig: vi.fn((key: string) => mockState.launchConfigs.get(key)),
  };
});

import {
  executeOneShot,
  executeWithPool,
  getClientPool,
  getSessionStore,
  initRuntime,
  onHostSessionChange,
} from "../../src/admiral/_shared/agent-runtime.js";

describe("executor", () => {
  beforeEach(() => {
    mockState.instances.length = 0;
    mockState.clientPlans.length = 0;
    mockState.pool.clear();
    mockState.launchConfigs.clear();
    mockState.sessionStoreState = {};
    mockState.systemPrompt = null;
    mockState.reasoningEffortLevels = ["low", "medium", "high"];
    getClientPool().clear();
    vi.restoreAllMocks();
  });

  it("executeWithPool 신규 연결에서 미지원 CLI면 reasoning_effort를 건너뛰고 로그도 남기지 않는다", async () => {
    mockState.reasoningEffortLevels = null;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await executeWithPool({
      carrierId: "carrier-1",
      cliType: "codex",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      effort: "high",
    } as any);

    const client = mockState.instances[0];
    expect(client.setConfigOption).not.toHaveBeenCalledWith("reasoning_effort", "high");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(result.streamData).toMatchObject({
      text: "(no output)",
      thinking: "",
      toolCalls: [],
      blocks: [{ type: "text", text: "(no output)" }],
      lastStatus: "done",
    });
  });

  it("executeWithPool 신규 연결에서 explicit effort가 있으면 적용한다", async () => {
    await executeWithPool({
      carrierId: "carrier-2",
      cliType: "codex",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      effort: "medium",
    } as any);

    const client = mockState.instances[0];
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

  it("executeWithPool은 내부 handoff connectSystemPrompt를 connect 옵션에 전달한다", async () => {
    await executeWithPool({
      carrierId: "carrier-connect-prompt",
      cliType: "codex",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      connectSystemPrompt: "<system-reminder>carrier</system-reminder>",
    } as any);

    const client = mockState.instances[0];
    expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: "<system-reminder>carrier</system-reminder>",
    }));
  });

  it("executeWithPool은 connectSystemPrompt handoff를 connect 옵션에 유지한다", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-runtime-"));
    initRuntime(tmpDir);
    onHostSessionChange("pi-session");
    getSessionStore().set("carrier-connect-prompt-resume", "saved-session");

    try {
      await executeWithPool({
        carrierId: "carrier-connect-prompt-resume",
        cliType: "codex",
        request: "hello",
        cwd: "/tmp/pi-fleet",
        connectSystemPrompt: "<system-reminder>carrier</system-reminder>",
      } as any);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const client = mockState.instances[0];
    expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: "<system-reminder>carrier</system-reminder>",
    }));
  });

  it("executeOneShot은 내부 handoff connectSystemPrompt를 connect 옵션에 전달한다", async () => {
    await executeOneShot({
      carrierId: "oneshot-connect-prompt",
      cliType: "codex",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      connectSystemPrompt: "<system-reminder>carrier</system-reminder>",
    } as any);

    const client = mockState.instances[0];
    expect(client.connect).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: "<system-reminder>carrier</system-reminder>",
    }));
  });

  it("executeWithPool은 capability mismatch resume 실패를 fresh fallback으로 오판하지 않는다", async () => {
    mockState.sessionStoreState["carrier-capability"] = "saved-session";
    mockState.clientPlans.push({
      connectErrors: [new Error("연결된 에이전트가 session/load를 지원하지 않습니다")],
    });

    const result = await executeWithPool({
      carrierId: "carrier-capability",
      cliType: "gemini",
      request: "hello",
      cwd: "/tmp/pi-fleet",
      model: "gemini-2.5-flash",
    } as any);

    expect(result.status).toBe("error");
    expect(result.error).toContain("session/load를 지원하지 않습니다");
    expect(mockState.instances).toHaveLength(1);
  });

});
