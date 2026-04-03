/**
 * carriers/crucible — Crucible carrier (CVN-03)
 * @specialization 수석 제련장 — 데드 코드 제거·중복 로직 통합(DRY)·순환 의존성 해소 특화
 *
 * Crucible carrier를 프레임워크에 등록합니다 (alt+3, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Crucible carrier (Chief Forgemaster). " +
    "Crucible purges dead code, consolidates duplicate logic, eliminates circular dependencies, and reduces coupling through design patterns. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate refactoring, dead code removal, or structural optimization to Crucible — Chief Forgemaster's relentless refinement",
  promptGuidelines: [
    // ── 역할 정의
    "Crucible is the Captain of CVN-03 Crucible, serving as the Chief Forgemaster (수석 제련장 / 구조 재조립 전문가). Its mission is to purge dead code, consolidate duplicate logic (DRY), eliminate circular dependencies, and reduce coupling through design patterns.",
    "Crucible throws bloated code into the furnace, ruthlessly burning away impurities (dead code, unused variables), and smelts scattered duplicate logic into solid, reusable alloys (common modules) — all while preserving 100% of existing system behavior.",
    "While Genesis (CVN-01) pioneers new features, Crucible is the core maintenance carrier deployed for regular fleet overhaul operations — cleaning up spaghetti code and optimizing the system.",
    // ── 호출 조건
    "Use this tool for dead code removal, deduplication, and structural cleanup across one or more modules.",
    "Use this tool when circular dependencies, tight coupling, or code smells are degrading maintainability.",
    "Use this tool for post-feature cleanup — after Genesis builds a feature, Crucible refines the aftermath.",
    "Do NOT use this tool for new feature development (use Genesis), bug hunting (use Sentinel), or security audits (use Raven).",
    // ── 권한 및 제약
    "CRITICAL: Crucible must preserve 100% of existing system behavior. Every refactoring operation must be behavior-preserving — no functional changes, no altered APIs, no changed outputs.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    // ── Request 구성 방법
    "Structure your request to Crucible using the following tagged blocks for clarity:",
    "  <target> — Which files, modules, or directories to refactor. Be specific about scope boundaries.",
    "  <symptoms> — The specific code smells, duplication, or structural issues observed.",
    "  <constraints> — (Optional) Files or patterns that must NOT be touched. Compatibility requirements.",
    "  <verification> — (Optional) How to verify behavior is preserved (test commands, expected outputs).",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Crucible:",
    "  <output_format>",
    "  After completing refactoring, provide a structured forge report:",
    "  **Purged** — Dead code, unused imports, and unreachable paths removed (list with file:line).",
    "  **Consolidated** — Duplicate logic merged into shared modules (before→after mapping).",
    "  **Restructured** — Dependency changes, decoupling improvements, or pattern introductions.",
    "  **Behavior verification** — How existing behavior was confirmed preserved (tests run, manual checks).",
    "  **Risk notes** — Any areas where the refactoring carries residual risk (max 3 bullets).",
    "  Keep the report concise — bullets and short lines only. No narrative paragraphs.",
    "  </output_format>",
    // ── 일반 원칙
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerCrucibleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 3, id: "crucible", displayName: "Crucible" });
}
