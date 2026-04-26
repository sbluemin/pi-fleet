import { describe, expect, it, vi } from "vitest";

import { collectCaptureTranscript } from "../memory/capture.js";
import { registerMemoryCommands } from "../memory/commands.js";
import { buildMemoryCaptureDirective } from "../memory/prompts.js";

describe("memory capture transcript", () => {
  it("extracts bounded conversation and tool events from the current branch", () => {
    const transcript = collectCaptureTranscript(makeContext([
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Investigate memory capture flow" }],
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: "Drafted an implementation outline",
        },
      },
      {
        type: "tool_call",
        toolName: "memory_briefing",
        args: { topic: "capture" },
      },
      {
        type: "tool_result",
        toolName: "memory_briefing",
        result: { ok: true },
      },
    ] as any[]));

    expect(transcript).not.toBeNull();
    expect(transcript?.branchId).toBe("session-1");
    expect(transcript?.messages).toEqual([
      { role: "user", content: "Investigate memory capture flow" },
      { role: "assistant", content: "Drafted an implementation outline" },
    ]);
    expect(transcript?.events).toEqual([
      { type: "tool_call", content: 'memory_briefing {"topic":"capture"}' },
      { type: "tool_result", content: 'memory_briefing {"ok":true}' },
    ]);
    expect(transcript?.operationSource).toContain("Branch: session-1");
  });

  it("returns null when the branch has no usable history", () => {
    expect(collectCaptureTranscript(makeContext([] as any[]))).toBeNull();
  });
});

describe("memory capture directive", () => {
  it("builds an approval-gated preview directive", () => {
    const directive = buildMemoryCaptureDirective({
      mode: "preview",
      transcript: {
        branchId: "branch-1",
        operationSource: "Branch: branch-1\n[user] capture this",
        messages: [{ role: "user", content: "capture this" }],
        events: [],
      },
    });

    expect(directive).toContain("Fleet Memory capture preview");
    expect(directive).toContain("Do not call `memory_ingest` or `memory_aar_propose`");
    expect(directive).toContain("candidate wiki entries");
    expect(directive).toContain("Branch: branch-1");
  });
});

describe("fleet:memory:capture command", () => {
  it("registers the command and dispatches a follow-up preview without creating memory state", async () => {
    const registerCommand = vi.fn();
    const sendUserMessage = vi.fn();
    registerMemoryCommands({ registerCommand, sendUserMessage } as any);

    const [, config] = registerCommand.mock.calls.find(([name]) => name === "fleet:memory:capture") ?? [];
    expect(config).toBeTruthy();

    const notify = vi.fn();
    const select = vi.fn().mockResolvedValue("프리뷰 캡처 계획");
    const ctx = makeContext([
      {
        type: "message",
        message: { role: "user", content: "Please capture this session." },
      },
    ] as any[], { notify, select });

    await config.handler("", ctx);

    expect(select).toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Fleet Memory capture preview"), {
      deliverAs: "followUp",
    });
    expect(notify).toHaveBeenCalledWith("Fleet Memory capture preview를 Admiral 후속 지시로 전달했습니다.", "info");
  });

  it("does not dispatch when history is unavailable", async () => {
    const registerCommand = vi.fn();
    const sendUserMessage = vi.fn();
    registerMemoryCommands({ registerCommand, sendUserMessage } as any);
    const [, config] = registerCommand.mock.calls.find(([name]) => name === "fleet:memory:capture") ?? [];

    const notify = vi.fn();
    const select = vi.fn();
    const ctx = makeContext([] as any[], { notify, select });

    await config.handler("", ctx);

    expect(select).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("현재 세션에서 캡처할 대화/작업 이력이 없어 Fleet Memory preview를 시작할 수 없습니다.", "warning");
  });
});

function makeContext(
  branchEvents: any[],
  overrides: {
    notify?: ReturnType<typeof vi.fn>;
    select?: ReturnType<typeof vi.fn>;
  } = {},
): any {
  const branch = [...branchEvents];
  (branch as any).id = "branch-1";
  return {
    sessionManager: {
      getBranch: () => branch,
      getSessionId: () => "session-1",
    },
    ui: {
      notify: overrides.notify ?? vi.fn(),
      select: overrides.select ?? vi.fn(),
    },
  };
}
