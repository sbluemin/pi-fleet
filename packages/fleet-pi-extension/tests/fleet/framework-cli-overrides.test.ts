import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";

import {
  getRegisteredCarrierConfig,
  getRegisteredOrder,
  registerCarrier,
  setPendingCliTypeOverrides,
} from "../../src/fleet/shipyard/carrier/framework.js";
import { CARRIER_FRAMEWORK_KEY, type CarrierConfig } from "../../src/fleet/shipyard/carrier/types.js";

const TEST_EXTENSION_API = {
  registerMessageRenderer: vi.fn(),
} as unknown as ExtensionAPI;

function makeCarrierConfig(id: string, cliType: CliType, slot: number): CarrierConfig {
  return {
    id,
    cliType,
    defaultCliType: cliType,
    slot,
    displayName: id,
    color: "",
  };
}

describe("framework cliType override restore", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[CARRIER_FRAMEWORK_KEY];
    vi.clearAllMocks();
  });

  it("이미 등록된 캐리어에도 cliType override를 즉시 적용한다", () => {
    registerCarrier(TEST_EXTENSION_API, makeCarrierConfig("vanguard", "gemini", 7));

    setPendingCliTypeOverrides({ vanguard: "codex" });

    expect(getRegisteredCarrierConfig("vanguard")?.cliType).toBe("codex");
  });

  it("미등록 캐리어 override는 pending으로 유지하다가 등록 시 적용한다", () => {
    setPendingCliTypeOverrides({ vanguard: "codex" });

    registerCarrier(TEST_EXTENSION_API, makeCarrierConfig("vanguard", "gemini", 7));

    expect(getRegisteredCarrierConfig("vanguard")?.cliType).toBe("codex");
  });

  it("즉시 적용 시 등록 순서를 새 cliType 기준으로 재정렬한다", () => {
    registerCarrier(TEST_EXTENSION_API, makeCarrierConfig("sentinel", "codex", 5));
    registerCarrier(TEST_EXTENSION_API, makeCarrierConfig("vanguard", "gemini", 7));

    setPendingCliTypeOverrides({ vanguard: "claude" });

    expect(getRegisteredOrder()).toEqual(["vanguard", "sentinel"]);
  });
});
