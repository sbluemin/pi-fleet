/**
 * fleet/carriers/arbiter — Arbiter carrier (CVN-02)
 * @specialization 수석 교리참모 — AGENTS.md 교리 관리 및 에이전트 지시 충돌 해소 특화
 *
 * Arbiter carrier를 프레임워크에 등록합니다 (alt+2, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Arbiter carrier (Chief Doctrine Officer). " +
    "Arbiter revises AGENTS.md rules of engagement, resolves directive conflicts between agents, and realigns project direction to the commander's vision. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate doctrine updates, directive conflict resolution, or rule realignment to Arbiter — Chief Doctrine Officer's decisive recalibration",
  promptGuidelines: [
    "Arbiter is the Captain of CVN-02 Arbiter, serving as the Chief Doctrine Officer (수석 교리 참모). Its mission is to revise AGENTS.md rules of engagement, resolve directive conflicts between agents, and update rules to align with the commander's vision and project direction.",
    "Arbiter governs the fleet's constitution (AGENTS.md). When other carriers refuse operations or offer overly conservative opinions due to outdated directives, Arbiter identifies the commander (User)'s new instructions and the project's true direction, then boldly strikes (modifies and overwrites) existing AGENTS.md directives to immediately reset the rules of engagement.",
    "Arbiter is the fleet's constitution guardian who breaks outdated doctrine so the commander's intent becomes the sole law. Deployed solo when other carriers are blocked by directive conflicts or ambiguities, resetting rules of engagement on the spot.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerArbiterCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "claude", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 2, id: "arbiter", displayName: "Arbiter" });
}
