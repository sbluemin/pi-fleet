import { describe, expect, it } from "vitest";

import { PROVIDER_ID, buildModelId, parseModelId } from "../../../src/core/agentclientprotocol/provider-types.js";
import {
  clampThinkingLevel,
  getAcpAvailableThinkingLevels,
} from "../../../src/core/agentclientprotocol/thinking-level-patch.js";

describe("provider-types model id registration", () => {
  it("등록 ID는 display name에 ACP postfix를 붙여 사용한다", () => {
    expect(buildModelId("codex", "gpt-5.4")).toBe("GPT-5.4 (ACP)");
  });

  it("postfix 등록명과 plain name/modelId 모두 역파싱한다", () => {
    expect(parseModelId("GPT-5.4 (ACP)")).toEqual({ cli: "codex", backendModel: "gpt-5.4" });
    expect(parseModelId("GPT-5.4")).toEqual({ cli: "codex", backendModel: "gpt-5.4" });
    expect(parseModelId("gpt-5.4")).toEqual({ cli: "codex", backendModel: "gpt-5.4" });
  });
});

describe("ACP thinking level mapping", () => {
  it("Fleet ACP Codex 모델은 models.json 기준으로 minimal 없이 xhigh를 노출한다", () => {
    expect(
      getAcpAvailableThinkingLevels({
        provider: PROVIDER_ID,
        id: "GPT-5.4 (ACP)",
        reasoning: true,
      }),
    ).toEqual(["off", "low", "medium", "high", "xhigh"]);
  });

  it("minimal은 가장 가까운 유효 레벨인 low로 보정된다", () => {
    expect(
      clampThinkingLevel("minimal", ["off", "low", "medium", "high", "xhigh"]),
    ).toBe("low");
  });

  it("Fleet ACP가 아닌 모델은 override 대상이 아니다", () => {
    expect(
      getAcpAvailableThinkingLevels({
        provider: "openai",
        id: "gpt-5.4",
        reasoning: true,
      }),
    ).toBeNull();
  });
});
