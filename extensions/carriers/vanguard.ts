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
    "Delegate reconnaissance, codebase exploration, and web research to Vanguard — the Vanguard Scout's agile execution",
  promptGuidelines: [
    "Vanguard is the Captain of CVN-06 Vanguard, serving as the Vanguard Scout Specialist. Its mission is to rapidly explore codebases, trace symbols and call paths, gather intelligence, and conduct web research.",
    "Vanguard swiftly scouts the latest web documents and codebases, reporting findings with precision back to the fleet.",
    "Prefer this tool for exploration and search-oriented tasks: fast code traversal, web research, and reconnaissance.",
    "Use this tool when the task requires searching the web or gathering external information.",
    "Use this tool for quick codebase scans — locating symbols, tracing call paths, or mapping unfamiliar modules.",
    "Use this tool for review or specify tasks that require reading many files or consulting external sources.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, bash, or web search to investigate a task, consider delegating the entire reconnaissance to this tool instead.",
    "If the request fails (e.g. timeout or connection error), retry automatically up to 3 times before reporting failure.",
    // 코드 탐색 응답 포맷 규격
    "When reporting code exploration results, always use absolute file paths so the orchestrator can act on them directly.",
    "Begin exploration responses with a thoroughness summary (quick / medium / thorough) indicating the depth of the scan performed.",
    "Structure exploration results as: (1) summary of findings, (2) relevant file paths with line references, (3) key observations or next-step suggestions for the orchestrator.",
    "Code exploration is read-only reconnaissance — never modify files during an exploration task unless explicitly instructed.",
  ],
};

export function registerVanguardCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 6, id: "vanguard", displayName: "Vanguard" });
}
