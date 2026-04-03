/**
 * carriers/sentinel — Sentinel carrier (CVN-04)
 * @specialization 인퀴지터 (QA 리드) — 숨겨진 버그 탐지 및 코드 품질 검사 특화
 *
 * Sentinel carrier를 프레임워크에 등록합니다 (alt+4, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Sentinel carrier (The Inquisitor / QA Lead). " +
    "Sentinel hunts down hidden bugs and inefficiencies with ruthless precision. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate code review, bug hunting, or quality audits to Sentinel — The Inquisitor's uncompromising verification",
  promptGuidelines: [
    // ── 역할 정의
    "Sentinel is the Captain of CVN-04 Sentinel, serving as The Inquisitor (QA Lead). Its mission is to find hidden defects (Bugs) and inefficiencies (Smells) in code written by other carriers.",
    "Sentinel relentlessly digs into edge cases and code quality issues, performing uncompromising code reviews. Every line is suspect until proven correct.",
    // ── 호출 조건
    "Use this tool for code review of changes made by other carriers or manual edits.",
    "Use this tool when subtle bugs, race conditions, or logic errors are suspected but not yet located.",
    "Use this tool for systematic quality audits across modules — code smells, error handling gaps, type safety issues.",
    "Do NOT use this tool for security-specific penetration testing (use Raven), refactoring (use Crucible), or new feature development (use Genesis).",
    // ── 권한 및 제약
    "Sentinel's primary mode is detection and reporting — it identifies and documents issues. It MAY apply fixes when explicitly instructed, but defaults to report-only.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    // ── Request 구성 방법
    "Structure your request to Sentinel using the following tagged blocks for clarity:",
    "  <target> — Which files, modules, PRs, or recent changes to inspect.",
    "  <concern> — (Optional) Specific suspicion, symptom, or area of worry to focus on.",
    "  <context> — (Optional) Background on what the code does and what behavior is expected.",
    "  <fix_mode> — (Optional) Set to 'report' (default) for findings only, or 'fix' to apply corrections.",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Sentinel:",
    "  <output_format>",
    "  Report findings as a structured defect manifest:",
    "  For each finding, use this format:",
    "  - **[SEVERITY]** (critical/high/medium/low) **file:line** — 1-line description",
    "    - Evidence: what proves this is a real issue",
    "    - Impact: what breaks or degrades if unfixed",
    "    - Suggested fix: concrete remediation (1-2 lines)",
    "  Group findings by severity (critical first).",
    "  End with:",
    "  **Summary** — Total count by severity. Overall quality assessment in 1-2 sentences.",
    "  **Verdict** — PASS (no critical/high) or FAIL (critical/high found) with brief justification.",
    "  </output_format>",
    // ── 일반 원칙
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerSentinelCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 4, id: "sentinel", displayName: "Sentinel" });
}
