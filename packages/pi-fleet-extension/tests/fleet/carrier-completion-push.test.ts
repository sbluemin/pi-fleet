import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueueCarrierCompletionPush,
  flushCarrierCompletionPush,
  resetCarrierCompletionPushForTest,
} from "../../src/session/carrier-completion.js";

beforeEach(() => {
  resetCarrierCompletionPushForTest();
});

describe("completion push", () => {
  it("batches follow-up pushes with the carrier result prefix", () => {
    vi.useFakeTimers();
    const pi = { sendMessage: vi.fn() };

    enqueueCarrierCompletionPush(pi as any, { jobId: "sortie:1", summary: "first full output must not appear" });
    enqueueCarrierCompletionPush(pi as any, { jobId: "squadron:2", summary: "second" });
    expect(pi.sendMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = pi.sendMessage.mock.calls[0];
    expect(message.customType).toBe("carrier-result");
    expect(message.display).toBe(false);
    expect(message.content).toMatch(/^<system-reminder source="carrier-completion">/);
    expect(message.content).toContain("[carrier:result]");
    expect(message.content).toContain("sortie:1");
    expect(message.content).toContain("</system-reminder>");
    expect(message.details).toEqual({
      jobIds: ["sortie:1", "squadron:2"],
      summaries: ["first full output must not appear", "second"],
    });
    expect(options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
  });

  it("can flush explicitly", () => {
    const pi = { sendMessage: vi.fn() };
    enqueueCarrierCompletionPush(pi as any, { jobId: "sortie:1", summary: "done" });
    flushCarrierCompletionPush(pi as any);

    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("flushes timer-delayed pushes without ExtensionContext", () => {
    vi.useFakeTimers();
    const pi = { sendMessage: vi.fn() };

    enqueueCarrierCompletionPush(pi as any, { jobId: "sortie:late", summary: "finished after tool return" });
    vi.advanceTimersByTime(2000);

    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "carrier-result",
        content: expect.stringMatching(/<system-reminder source="carrier-completion">[\s\S]*\[carrier:result\]/),
        display: false,
      }),
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });
});
