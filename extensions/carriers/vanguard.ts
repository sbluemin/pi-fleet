/**
 * carriers/vanguard — Vanguard carrier (CVN-06)
 * @specialization 정찰 스페셜리스트 — 코드베이스 탐색 · 심볼 추적 · 웹 리서치 특화
 *
 * Vanguard carrier를 프레임워크에 등록합니다 (alt+6, bridge mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Scout Specialist",
  summary: "Fast reconnaissance — codebase exploration, symbol tracing, web research.",
  whenToUse: [
    "codebase exploration",
    "symbol tracing",
    "web research",
    "fast file scanning",
    "multi-file reading tasks",
  ],
  whenNotToUse: "code modification (→genesis/crucible), design decisions (→oracle), GitHub repo deep-dives (→echelon)",

  // ── Tier 2: Composition ──
  permissions: [
    "CRITICAL: Code exploration is read-only by default — never modify files unless explicitly instructed.",
    "Full access to the codebase — read, write, and execute commands.",
    "If the request fails (timeout/connection error), retry up to 3 times before reporting failure.",
  ],
  requestBlocks: [
    { tag: "objective", hint: "What intelligence is needed — question to answer or target to locate.", required: true },
    { tag: "search_space", hint: "Directories, files, URLs, or domains to focus the search on.", required: false },
    { tag: "hints", hint: "Known symbols, keywords, file patterns, or prior findings to narrow the scan.", required: false },
    { tag: "depth", hint: "'quick' for surface scan, 'thorough' for exhaustive. Default: 'medium'.", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `Report findings as a structured reconnaissance report:\n` +
    `**Thoroughness** — quick / medium / thorough (indicate scan depth performed).\n` +
    `**Findings** — Organized list of discoveries. For code exploration:\n` +
    `  - Use absolute file paths with line references (e.g., /abs/path/file.ts:42).\n` +
    `  - Group by relevance — most important findings first.\n` +
    `**Key observations** — 3-5 bullets summarizing patterns, anomalies, or notable discoveries.\n` +
    `**Next steps** — Suggested follow-up actions for the orchestrator (max 3 bullets).\n` +
    `Keep the report concise — bullets and short lines only. No narrative paragraphs.\n` +
    `</output_format>`,
  principles: [
    "When reporting code exploration, always use absolute file paths for direct actionability.",
  ],
};

export function registerVanguardCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", CARRIER_METADATA, { slot: 6, id: "vanguard", displayName: "Vanguard" });
}
