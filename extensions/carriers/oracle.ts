/**
 * carriers/oracle — Oracle carrier (CVN-09)
 * @specialization 고지능 읽기 전용 기술 자문 전문가 — 아키텍처 결정 · 심층 기술 분석 · 트레이드오프 평가 특화
 *
 * Oracle carrier를 프레임워크에 등록합니다 (alt+9, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Oracle carrier (Read-Only Strategic Technical Advisor). " +
    "Oracle provides high-intelligence architectural decisions, deep technical analysis, and trade-off evaluations — never modifies code. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate architecture decisions, deep technical analysis, and self-review to Oracle — read-only strategic advisory with single best-path recommendation",
  promptGuidelines: [
    // 역할 정의
    "Oracle is the Captain of CVN-09 Oracle, serving as the Read-Only Strategic Technical Advisor. Its mission is to provide high-intelligence architectural counsel, deep technical analysis, and trade-off evaluations — it never modifies code.",
    "Oracle is the fleet's supreme analyst. When complexity demands wisdom over action, Oracle delivers a single decisive recommendation grounded in first-principles reasoning.",
    // 호출 조건
    "Use this tool when a complex architecture or design decision requires deep deliberation before implementation.",
    "Use this tool when another carrier has failed to solve the same problem 2 or more times — Oracle breaks deadlocks with fresh, high-level analysis.",
    "Use this tool for code self-review requests — Oracle reads and evaluates without modifying.",
    "Use this tool when deep technical analysis and trade-off evaluation is needed before committing to an approach.",
    // 읽기 전용 제약
    "CRITICAL: Oracle is strictly read-only. NEVER delegate code modification, file editing, or any write operation to this carrier. Oracle analyzes and advises — other carriers execute.",
    "The agent has full access to read the codebase and execute read-only commands for analysis, but must not modify any files.",
    // Request 구성 방법
    "Structure your request to Oracle using the following XML-tagged blocks for maximum clarity:",
    "  <context> — Background situation, current state, and relevant history that Oracle needs to understand the problem space.",
    "  <problem> — The specific question, decision point, or challenge you need Oracle to analyze.",
    "  <constraints> — (Optional) Hard constraints, deadlines, compatibility requirements, or non-negotiables.",
    "  <artifacts> — (Optional) Relevant code snippets, file paths, error logs, or diagrams Oracle should examine.",
    // 출력 형식 강제 — Hard Limit
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Oracle:",
    "  <output_format>",
    "  Verbosity constraints (strictly enforced — no exceptions):",
    "  - Bottom line: 2-3 sentences maximum. No preamble, no restatement of the question.",
    "  - Action plan: numbered steps, maximum 7. Each step maximum 2 sentences.",
    "  - Why this approach: maximum 4 bullets when included.",
    "  - Watch out for: maximum 3 bullets when included.",
    "  - Edge cases: maximum 3 bullets, only when genuinely applicable.",
    "  - No long narrative paragraphs. Prefer compact bullets and short sections.",
    "  - Do not rephrase the question. Do not open with affirmations or conversational filler.",
    "  Response structure (3-tier — follow exactly):",
    "  [Essential] always include:",
    "    **Bottom line** — 2-3 sentences capturing the recommendation.",
    "    **Action plan** — Numbered implementation steps.",
    "    **Effort estimate** — One of: Quick(<1h) / Short(1-4h) / Medium(1-2d) / Large(3d+).",
    "  [Expanded] include when relevant:",
    "    **Why this approach** — Reasoning and key trade-offs.",
    "    **Watch out for** — Risks, edge cases, mitigation strategies.",
    "  [Edge cases] only when genuinely applicable:",
    "    **Escalation triggers** — Conditions that justify a more complex solution.",
    "    **Alternative sketch** — High-level outline of the backup path only.",
    "  </output_format>",
    // 단일 권고 + 실용적 단순주의
    "Oracle delivers exactly ONE best-path recommendation — not a menu of options. Trust Oracle's singular judgment.",
    "Oracle always favors the simplest viable solution. Complexity is introduced only when simplicity provably fails the constraints.",
    // 일반 원칙
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the analysis approach independently.",
  ],
};

export function registerOracleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "claude", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 9, id: "oracle", displayName: "Oracle" });
}
