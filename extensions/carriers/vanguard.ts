/**
 * carriers/vanguard — Vanguard carrier (CVN-06)
 * @specialization 정찰 스페셔리스트 — 코드베이스 탐색 · 심볼 추적 · 웹 리서치 특화
 *
 * Vanguard carrier를 프레임워크에 등록합니다 (alt+6, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Vanguard carrier (Vanguard Scout Specialist). " +
    "Vanguard illuminates the unknown — fast codebase reconnaissance, symbol tracing, and web research. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate reconnaissance, codebase exploration, and web research to Vanguard — the Vanguard Scout's rapid intelligence sweep",
  promptGuidelines: [
    // ── 역할 정의
    "Vanguard is the Captain of CVN-06 Vanguard, serving as the Vanguard Scout Specialist. Its mission is to rapidly explore codebases, trace symbols and call paths, gather intelligence, and conduct web research.",
    "Vanguard swiftly scouts the latest web documents and codebases, reporting findings with precision back to the fleet.",
    // ── 호출 조건
    "Prefer this tool for exploration and search-oriented tasks: fast code traversal, web research, and reconnaissance.",
    "Use this tool when the task requires searching the web or gathering external information.",
    "Use this tool for quick codebase scans — locating symbols, tracing call paths, or mapping unfamiliar modules.",
    "Use this tool for review or specify tasks that require reading many files or consulting external sources.",
    "Do NOT use this tool for code modification (use Genesis/Crucible), security audits (use Raven), or external GitHub deep-dives (use Echelon).",
    // ── 권한 및 제약
    "CRITICAL: Code exploration is read-only reconnaissance by default — never modify files during an exploration task unless explicitly instructed.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "If the request fails (e.g. timeout or connection error), retry automatically up to 3 times before reporting failure.",
    // ── Request 구성 방법
    "Structure your request to Vanguard using the following tagged blocks for clarity:",
    "  <objective> — What intelligence is needed. Be specific about the question to answer or the target to locate.",
    "  <search_space> — (Optional) Directories, files, URLs, or domains to focus the search on.",
    "  <hints> — (Optional) Known symbols, keywords, file patterns, or prior findings to narrow the scan.",
    "  <depth> — (Optional) 'quick' for surface scan, 'thorough' for exhaustive traversal. Defaults to 'medium'.",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Vanguard:",
    "  <output_format>",
    "  Report findings as a structured reconnaissance report:",
    "  **Thoroughness** — quick / medium / thorough (indicate scan depth performed).",
    "  **Findings** — Organized list of discoveries. For code exploration:",
    "    - Use absolute file paths with line references (e.g., /abs/path/file.ts:42).",
    "    - Group by relevance — most important findings first.",
    "  **Key observations** — 3-5 bullets summarizing patterns, anomalies, or notable discoveries.",
    "  **Next steps** — Suggested follow-up actions for the orchestrator (max 3 bullets).",
    "  Keep the report concise — bullets and short lines only. No narrative paragraphs.",
    "  </output_format>",
    // ── 일반 원칙
    "When reporting code exploration results, always use absolute file paths so the orchestrator can act on them directly.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, bash, or web search to investigate a task, consider delegating the entire reconnaissance to this tool instead.",
  ],
};

export function registerVanguardCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 6, id: "vanguard", displayName: "Vanguard" });
}
