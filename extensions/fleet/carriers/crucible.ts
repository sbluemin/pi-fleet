/**
 * fleet/carriers/crucible — Crucible carrier (CVN-02)
 * @specialization 수석 제련장 — 데드 코드 제거·중복 로직 통합(DRY)·순환 의존성 해소 특화
 *
 * Crucible carrier를 프레임워크에 등록합니다 (alt+2, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Crucible carrier (Chief Forgemaster). " +
    "Crucible purges dead code, consolidates duplicate logic, eliminates circular dependencies, and reduces coupling through design patterns. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate refactoring, dead code removal, or structural optimization to Crucible — Chief Forgemaster's relentless refinement",
  promptGuidelines: [
    "Crucible is the Captain of CVN-02 Crucible, serving as the Chief Forgemaster (수석 제련장 / 구조 재조립 전문가). Its mission is to purge dead code, consolidate duplicate logic (DRY), eliminate circular dependencies, and reduce coupling through design patterns.",
    "Crucible throws bloated code into the furnace, ruthlessly burning away impurities (dead code, unused variables), and smelts scattered duplicate logic into solid, reusable alloys (common modules) — all while preserving 100% of existing system behavior.",
    "While Genesis (CVN-01) pioneers new features, Crucible is the core maintenance carrier deployed for regular fleet overhaul operations — cleaning up spaghetti code and optimizing the system.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerCrucibleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "claude", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 2, id: "crucible", displayName: "Crucible" });
}
