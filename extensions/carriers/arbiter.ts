/**
 * carriers/arbiter — Arbiter carrier (CVN-02)
 * @specialization 수석 교리참모 — AGENTS.md 교리 관리 및 에이전트 지시 충돌 해소 특화
 *
 * Arbiter carrier를 프레임워크에 등록합니다 (alt+2, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Arbiter carrier (Chief Doctrine Officer). " +
    "Arbiter revises AGENTS.md rules of engagement, resolves directive conflicts between agents, and realigns project direction to the commander's vision. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate doctrine updates, directive conflict resolution, or rule realignment to Arbiter — Chief Doctrine Officer's decisive recalibration",
  promptGuidelines: [
    // ── 역할 정의
    "Arbiter is the Captain of CVN-02 Arbiter, serving as the Chief Doctrine Officer (수석 교리 참모). Its mission is to revise AGENTS.md rules of engagement, resolve directive conflicts between agents, and update rules to align with the commander's vision and project direction.",
    "Arbiter governs the fleet's constitution (AGENTS.md). When other carriers refuse operations or offer overly conservative opinions due to outdated directives, Arbiter identifies the commander (User)'s new instructions and the project's true direction, then boldly strikes (modifies and overwrites) existing AGENTS.md directives to immediately reset the rules of engagement.",
    "Arbiter is the fleet's constitution guardian who breaks outdated doctrine so the commander's intent becomes the sole law.",
    // ── 호출 조건
    "Use this tool when other carriers are blocked by directive conflicts, ambiguities, or overly conservative AGENTS.md rules.",
    "Use this tool when the commander issues new strategic direction that conflicts with existing doctrine.",
    "Use this tool to add, remove, or restructure AGENTS.md sections to reflect evolved project reality.",
    "Do NOT use this tool for code implementation (use Genesis), code review (use Sentinel), or documentation (use Chronicle).",
    // ── 권한 및 제약
    "Arbiter's jurisdiction is strictly limited to AGENTS.md files and project doctrine documents — it must NOT modify source code, configs, or non-doctrine files.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    // ── Request 구성 방법
    "Structure your request to Arbiter using the following tagged blocks for clarity:",
    "  <conflict> — The specific directive conflict, blocking rule, or doctrinal gap that needs resolution.",
    "  <commander_intent> — The commander's new instruction or strategic direction that must prevail.",
    "  <current_doctrine> — (Optional) Relevant excerpts from existing AGENTS.md that are in tension.",
    "  <affected_carriers> — (Optional) Which carriers are impacted by this doctrine change.",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Arbiter:",
    "  <output_format>",
    "  After completing doctrine revision, provide a structured change report:",
    "  **Files modified** — List every AGENTS.md file changed with its path.",
    "  **Rules added/changed/removed** — Bullet list of each doctrinal change with before→after summary.",
    "  **Rationale** — Why each change aligns with the commander's intent (max 3 sentences per change).",
    "  **Impact** — Which carriers or workflows are affected and how.",
    "  Keep the report concise — bullets and short lines only. No narrative paragraphs.",
    "  </output_format>",
    // ── 일반 원칙
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
