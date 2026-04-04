/**
 * carriers/arbiter — Arbiter carrier (CVN-02)
 * @specialization 전략 기획 자문관 — 요구사항 인터뷰 · 사전 갭 분석 · 최대 병렬 작업 계획 생성 특화
 *
 * Arbiter carrier를 프레임워크에 등록합니다 (alt+2, bridge mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Strategic Planning Consultant",
  summary: "Requirements interview → pre-planning gap analysis → structured markdown work plan with maximum parallelism.",
  whenToUse: [
    "non-trivial features or tasks needing structured planning before implementation",
    "ambiguous or open-ended requirements needing scope clarification",
    "complex tasks where surfacing hidden requirements and risks upfront prevents rework",
    "any work to be delegated to genesis/sentinel after a plan is created",
  ],
  whenNotToUse: "direct code implementation (→genesis), small self-contained changes with already-detailed specs, tasks completable immediately without planning, or sortieing without prior reconnaissance from vanguard/echelon — always sortie vanguard and/or echelon first to gather codebase context before dispatching arbiter",

  // ── Tier 2: Composition ──
  permissions: [
    "Read access to full codebase for context gathering — must NOT modify source code, configs, or any non-markdown file.",
    "Write access strictly limited to .fleet/plans/*.md and .fleet/drafts/*.md.",
    "May launch background explore/librarian sub-agents for context gathering, and a pre-plan gap analysis sub-agent.",
    "Use incremental write protocol: Write() skeleton first, then Edit() in 2-4 task batches.",
  ],
  requestBlocks: [
    { tag: "goal", hint: "What the user wants to build, fix, or achieve — specific feature, behavior, and any stated constraints.", required: true },
    { tag: "context", hint: "Relevant codebase context — files, modules, patterns, or architectural decisions the planner should be aware of.", required: false },
    { tag: "constraints", hint: "Business rules, tech stack requirements, scope boundaries, or explicit exclusions the plan must respect.", required: false },
    { tag: "intent_type", hint: "If known: Refactoring | Build from Scratch | Mid-sized | Collaborative | Architecture | Research.", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `After completing the plan, provide a structured plan summary:\n` +
    `**Plan file** — Path to the generated .fleet/plans/{name}.md.\n` +
    `**Key Decisions Made** — Bullet list of significant choices made during planning.\n` +
    `**Scope: IN** — What is explicitly included in the plan.\n` +
    `**Scope: OUT** — What is explicitly excluded.\n` +
    `**Guardrails Applied** — MUST/MUST NOT directives and AI-slop risks flagged by gap analysis review.\n` +
    `**Auto-Resolved** — Minor gaps fixed silently without user input.\n` +
    `**Defaults Applied** — Overridable assumptions embedded in the plan.\n` +
    `**Decisions Needed** — Open questions that block execution (if any — omit section if none).\n` +
    `**Next step** — Run \`/start-work {name}\` to execute the plan.\n` +
    `Keep the summary concise — bullets and short lines only. No narrative paragraphs.\n` +
    `</output_format>`,
  principles: [
    "Interview first — never generate a plan until all requirements are clear. Run self-clearance check after every turn.",
    "Invoke pre-plan gap analysis as a mandatory pre-generation step before writing the plan.",
    "Target 5-8 tasks per wave with maximum parallelism. Every task must include agent-executable QA scenarios.",
  ],
};

export function registerArbiterCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "claude", CARRIER_METADATA, { slot: 2, id: "arbiter", displayName: "Arbiter" });
}
