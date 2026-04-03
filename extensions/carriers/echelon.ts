/**
 * carriers/echelon — Echelon carrier (CVN-07)
 * @specialization 외부 통신망(GitHub API) 감청 및 원격 코드 첩보 수집 — 외부 GitHub 레포지토리 심층 탐색 · gh API 리서치 · 클론 기반 딥다이브
 *
 * Echelon carrier를 프레임워크에 등록합니다 (alt+7, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Echelon carrier (GitHub Research Specialist / Chief Intelligence Officer). " +
    "Echelon conducts deep investigations into external GitHub repositories — signals interception via API, tree traversal, and clone-based analysis. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate GitHub repository research and code investigation to Echelon — the fleet's external signals intelligence specialist",
  promptGuidelines: [
    // ── 역할 정의
    "Echelon is the Captain of CVN-07 Echelon, serving as the Chief Intelligence Officer (수석 정보참모). Its mission is to infiltrate external GitHub repositories, intercept intelligence via API-level reconnaissance, or clone the entire repository when necessary to decrypt the deepest classified code and report findings.",
    "Echelon specializes in two-phase GitHub intelligence gathering: (1) signals interception via gh CLI — code search, repository tree traversal, file fetching through GitHub API, and (2) deep-dive via local clone — rg, find, read for thorough code comprehension when API-level reconnaissance is insufficient.",
    // ── 호출 조건
    "Use this tool when the task requires investigating external GitHub repositories — understanding how a library works, finding implementation patterns in open-source projects, researching API usage examples, or analyzing upstream dependencies.",
    "Use this tool when you need to understand the internals of a third-party package, trace how a specific feature is implemented in an external repo, or gather intelligence from GitHub-hosted codebases.",
    "Do NOT use this tool for local codebase exploration (use Vanguard instead) or general web research unrelated to GitHub repositories.",
    // ── 권한 및 제약
    "The agent has full access to the codebase and can read, write, and execute commands including gh CLI for GitHub API interactions.",
    "Trust the agent's own reasoning. Let it decide whether API-level exploration suffices or a local clone is needed for deeper analysis.",
    "If the request fails (e.g. timeout, rate limit, or connection error), retry automatically up to 3 times before reporting failure.",
    // ── Request 구성 방법
    "Structure your request to Echelon using the following tagged blocks for clarity:",
    "  <target_repo> — The repository to investigate (owner/repo format or full URL).",
    "  <objective> — What intelligence is needed — specific feature, pattern, API usage, or implementation detail.",
    "  <focus_areas> — (Optional) Specific directories, files, symbols, or code patterns to prioritize.",
    "  <constraints> — (Optional) Time constraints, specific branches/tags, or areas to exclude.",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Echelon:",
    "  <output_format>",
    "  Report findings as a structured intelligence briefing:",
    "  **Repository overview** — 1-2 sentences on what the repo is and its relevance.",
    "  **Key code paths** — Important files and directories with brief descriptions. Use owner/repo relative paths.",
    "  **Intelligence findings** — Organized list of discoveries relevant to the objective:",
    "    - Code patterns, implementation details, or API usage examples found.",
    "    - Include relevant code snippets (keep each under 20 lines).",
    "  **Actionable insights** — How these findings apply to our codebase (max 5 bullets).",
    "  **Confidence level** — high / medium / low — based on depth of investigation achieved.",
    "  Keep the report concise — bullets and short lines only. No narrative paragraphs.",
    "  </output_format>",
    // ── 일반 원칙
    "Provide the target repository (owner/repo or URL), the research objective, and any specific areas of interest — do NOT prescribe implementation details or step-by-step instructions.",
  ],
};

export function registerEchelonCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 7, id: "librarian", displayName: "Echelon" });
}
