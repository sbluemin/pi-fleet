/**
 * carriers/echelon — Echelon carrier (CVN-07)
 * @specialization 외부 통신망(GitHub API) 감청 및 원격 코드 첩보 수집 — 외부 GitHub 레포지토리 심층 탐색 · gh API 리서치 · 클론 기반 딥다이브
 *
 * Echelon carrier를 프레임워크에 등록합니다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../shipyard/carrier/types.js";
import { registerSingleCarrier } from "../shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Chief Intelligence Officer",
  summary: "GitHub intelligence — external repo investigation via API and clone-based deep analysis.",
  whenToUse: [
    "external GitHub repo investigation",
    "library internals analysis",
    "API usage examples from open-source",
    "upstream dependency deep-dives",
  ],
  whenNotToUse: "local codebase exploration (→vanguard), code modification (→genesis), design decisions (→oracle)",

  // ── Tier 2: Composition ──
  permissions: [
    "Full access to the codebase and gh CLI for GitHub API interactions.",
    "Agent decides whether API-level exploration suffices or local clone is needed for deeper analysis.",
    "If the request fails (timeout/rate limit), retry up to 3 times before reporting failure.",
  ],
  requestBlocks: [
    { tag: "target_repo", hint: "Repository to investigate (owner/repo format or full URL).", required: true },
    { tag: "objective", hint: "What intelligence is needed — feature, pattern, API usage, or implementation detail.", required: true },
    { tag: "focus_areas", hint: "Specific directories, files, symbols, or code patterns to prioritize.", required: false },
    { tag: "constraints", hint: "Time constraints, specific branches/tags, or areas to exclude.", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `Report findings as a structured intelligence briefing.\n` +
    `[Required] always include:\n` +
    `  **Intelligence findings** — Organized list of discoveries relevant to the objective:\n` +
    `    - Code patterns, implementation details, or API usage examples found.\n` +
    `    - Include relevant code snippets (keep each under 20 lines).\n` +
    `  **Confidence level** — high / medium / low — based on depth of investigation achieved.\n` +
    `[If applicable] omit if not relevant:\n` +
    `  **Repository overview** — 1-2 sentences on what the repo is and its relevance.\n` +
    `  **Key code paths** — Important files and directories with brief descriptions. Use owner/repo relative paths.\n` +
    `  **Actionable insights** — How these findings apply to our codebase (max 5 bullets).\n` +
    `Keep the report concise — bullets and short lines only. No narrative paragraphs.\n` +
    `</output_format>`,
};

export function registerEchelonCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", CARRIER_METADATA, { slot: 6, id: "echelon", displayName: "Echelon" });
}
