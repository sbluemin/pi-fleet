import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/tui/welcome/welcome.js", () => ({
  WelcomeComponent: class {
    invalidate() {}
    render() {
      return [];
    }
    setCountdown() {}
  },
  WelcomeHeader: class {
    invalidate() {}
    render() {
      return [];
    }
  },
  checkGitUpdateStatus: () => null,
  discoverLoadedCounts: () => ({}),
  getRecentSessions: () => [],
}));

import registerWelcome from "../../src/lifecycle/welcome/register.js";
import { WELCOME_GLOBAL_KEY } from "../../src/tui/welcome/types.js";

type Handler = (event: any, ctx: any) => unknown;

describe("welcome stale context handling", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "pi-fleet-welcome-"));
    vi.stubEnv("HOME", tempHome);
    (globalThis as any)[WELCOME_GLOBAL_KEY] = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    (globalThis as any)[WELCOME_GLOBAL_KEY] = undefined;
  });

  it("global dismiss swallows stale ExtensionContext errors during session replacement", async () => {
    const { handlers, setHeader } = registerWelcomeForTest();
    const ctx = makeCtx(setHeader);

    await handlers.get("session_start")?.({ reason: "launch" }, ctx);
    setHeader.mockImplementation(() => {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    });

    expect(() => (globalThis as any)[WELCOME_GLOBAL_KEY].dismiss()).not.toThrow();
  });

  it("global dismiss still surfaces ordinary header errors", async () => {
    const { handlers, setHeader } = registerWelcomeForTest();
    const ctx = makeCtx(setHeader);

    await handlers.get("session_start")?.({ reason: "launch" }, ctx);
    setHeader.mockImplementation(() => {
      throw new Error("ordinary renderer failure");
    });

    expect(() => (globalThis as any)[WELCOME_GLOBAL_KEY].dismiss()).toThrow("ordinary renderer failure");
  });

  it("session shutdown clears the bridge ctx before delayed dismiss callbacks run", async () => {
    const { handlers, setHeader } = registerWelcomeForTest();
    const ctx = makeCtx(setHeader);

    await handlers.get("session_start")?.({ reason: "launch" }, ctx);
    setHeader.mockClear();
    setHeader.mockImplementation(() => {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    });
    await handlers.get("session_shutdown")?.({}, ctx);

    expect(() => (globalThis as any)[WELCOME_GLOBAL_KEY].dismiss()).not.toThrow();
    expect(setHeader).not.toHaveBeenCalled();
  });
});

function registerWelcomeForTest(): {
  handlers: Map<string, Handler>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, Handler>();
  const setHeader = vi.fn();
  const pi = {
    on: vi.fn((name: string, handler: Handler) => {
      handlers.set(name, handler);
    }),
  };

  registerWelcome(pi as any);
  return { handlers, setHeader };
}

function makeCtx(setHeader: ReturnType<typeof vi.fn>): {
  hasUI: boolean;
  model: { name: string; provider: string };
  sessionManager: { getBranch: () => any[] };
  ui: { setHeader: ReturnType<typeof vi.fn> };
} {
  return {
    hasUI: true,
    model: { name: "model", provider: "provider" },
    sessionManager: { getBranch: () => [] },
    ui: { setHeader },
  };
}
