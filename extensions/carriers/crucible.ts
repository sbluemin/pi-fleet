/**
 * carriers/crucible — Crucible carrier (CVN-03)
 * @specialization 수석 제련장 — 데드 코드 제거·중복 로직 통합(DRY)·순환 의존성 해소 특화
 *
 * Crucible carrier를 프레임워크에 등록합니다 (alt+3, bridge mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Chief Forgemaster",
  summary: "Refactoring analyst — analyzes dead code, duplication, and circular dependencies, then proposes a refactoring plan for Genesis to execute.",
  whenToUse: [
    "dead code removal",
    "deduplication (DRY)",
    "decoupling and dependency cleanup",
    "post-feature structural cleanup",
  ],
  whenNotToUse: "before genesis implementation is done. New features (→genesis), bug detection (→sentinel), security (→raven)",

  // ── Tier 2: Composition ──
  permissions: [
    "CRITICAL: Strictly read-only. NEVER delegate code modification or file editing to this carrier.",
    "Full access to read the codebase and execute read-only commands for analysis.",
    "Crucible analyzes and proposes refactoring plans — actual code changes are delegated to Genesis.",
  ],
  requestBlocks: [
    { tag: "target", hint: "Which files, modules, or directories to refactor.", required: true },
    { tag: "symptoms", hint: "The specific code smells, duplication, or structural issues observed.", required: true },
    { tag: "constraints", hint: "Files or patterns that must NOT be touched. Compatibility requirements.", required: false },
    { tag: "verification", hint: "How to verify behavior is preserved (test commands, expected outputs).", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `Provide a structured refactoring proposal (read-only analysis — do NOT modify any files):\n` +
    `**Purge targets** — Dead code, unused imports, and unreachable paths identified (list with file:line).\n` +
    `**Consolidation plan** — Duplicate logic to merge, with before→after mapping and target shared modules.\n` +
    `**Restructuring plan** — Proposed dependency changes, decoupling improvements, or pattern introductions.\n` +
    `**Verification strategy** — How to confirm behavior is preserved after changes (test commands, expected outputs).\n` +
    `**Risk notes** — Areas where the proposed refactoring carries residual risk (max 3 bullets).\n` +
    `**Genesis handoff** — Concise implementation instructions ready for Genesis to execute the proposed changes.\n` +
    `Keep the report concise — bullets and short lines only. No narrative paragraphs.\n` +
    `</output_format>`,
};

export function registerCrucibleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", CARRIER_METADATA, { slot: 4, id: "crucible", displayName: "Crucible" });
}
