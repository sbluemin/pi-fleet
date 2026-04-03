/**
 * carriers/arbiter — Arbiter carrier (CVN-02)
 * @specialization 수석 교리참모 — AGENTS.md 교리 관리 및 에이전트 지시 충돌 해소 특화
 *
 * Arbiter carrier를 프레임워크에 등록합니다 (alt+2, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Chief Doctrine Officer",
  summary: "Doctrine guardian — revises AGENTS.md rules and resolves directive conflicts between carriers.",
  whenToUse: [
    "directive conflicts blocking other carriers",
    "AGENTS.md rule updates",
    "doctrinal realignment to commander intent",
  ],
  whenNotToUse: "code implementation (→genesis), code review (→sentinel), documentation (→chronicle)",

  // ── Tier 2: Composition ──
  permissions: [
    "Jurisdiction strictly limited to AGENTS.md files and project doctrine documents — must NOT modify source code, configs, or non-doctrine files.",
    "Full access to the codebase — read, write, and execute commands.",
  ],
  requestBlocks: [
    { tag: "conflict", hint: "The directive conflict, blocking rule, or doctrinal gap that needs resolution.", required: true },
    { tag: "commander_intent", hint: "The commander's new instruction or strategic direction that must prevail.", required: true },
    { tag: "current_doctrine", hint: "Relevant excerpts from existing AGENTS.md that are in tension.", required: false },
    { tag: "affected_carriers", hint: "Which carriers are impacted by this doctrine change.", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `After completing doctrine revision, provide a structured change report:\n` +
    `**Files modified** — List every AGENTS.md file changed with its path.\n` +
    `**Rules added/changed/removed** — Bullet list of each doctrinal change with before→after summary.\n` +
    `**Rationale** — Why each change aligns with the commander's intent (max 3 sentences per change).\n` +
    `**Impact** — Which carriers or workflows are affected and how.\n` +
    `Keep the report concise — bullets and short lines only. No narrative paragraphs.\n` +
    `</output_format>`,
};

export function registerArbiterCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "claude", CARRIER_METADATA, { slot: 2, id: "arbiter", displayName: "Arbiter" });
}
