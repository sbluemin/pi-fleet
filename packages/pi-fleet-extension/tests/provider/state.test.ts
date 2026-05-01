import { describe, expect, it, vi } from "vitest";

vi.mock("@sbluemin/unified-agent", () => ({
  getModelsRegistry: () => ({
    providers: {
      codex: {
        name: "OpenAI Codex CLI",
        models: [{ modelId: "gpt-5.5", name: "GPT-5.5" }],
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

import {
  buildModelId,
  buildProviderId,
  parseModelId,
  parseProviderId,
} from "../../src/agent/provider-internal/state.js";

describe("provider state codec", () => {
  it("새 등록 라벨은 Unified/provider canonical name을 사용한다", () => {
    expect(buildProviderId("codex")).toBe("OpenAI Codex CLI");
    expect(buildModelId("codex", "gpt-5.5")).toBe("GPT-5.5 (Unified)");
  });

  it("기존 ACP suffix와 Fleet provider prefix도 계속 해석한다", () => {
    expect(parseProviderId("Fleet OpenAI Codex CLI")).toBe("codex");
    expect(parseModelId("GPT-5.5 (ACP)", "Fleet OpenAI Codex CLI")).toEqual({
      cli: "codex",
      backendModel: "gpt-5.5",
    });
  });
});
