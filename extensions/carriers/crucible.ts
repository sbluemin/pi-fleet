/**
 * carriers/crucible — Crucible carrier (CVN-03)
 * @specialization 수석 제련장 — 데드 코드 제거·중복 로직 통합(DRY)·순환 의존성 해소 특화
 *
 * Crucible carrier를 프레임워크에 등록합니다 (alt+3, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Chief Forgemaster",
  summary: "Refactoring furnace — purges dead code, consolidates duplicates, eliminates circular dependencies.",
  whenToUse: [
    "dead code removal",
    "deduplication (DRY)",
    "decoupling and dependency cleanup",
    "post-feature structural cleanup",
  ],
  whenNotToUse: "before genesis implementation is done. New features (→genesis), bug detection (→sentinel), security (→raven)",

  // ── Tier 2: Composition ──
  permissions: [
    "CRITICAL: Must preserve 100% of existing system behavior — every refactoring is behavior-preserving.",
    "Full access to the codebase — read, write, and execute commands.",
  ],
  requestBlocks: [
    { tag: "target", hint: "Which files, modules, or directories to refactor.", required: true },
    { tag: "symptoms", hint: "The specific code smells, duplication, or structural issues observed.", required: true },
    { tag: "constraints", hint: "Files or patterns that must NOT be touched. Compatibility requirements.", required: false },
    { tag: "verification", hint: "How to verify behavior is preserved (test commands, expected outputs).", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `After completing refactoring, provide a structured forge report:\n` +
    `**Purged** — Dead code, unused imports, and unreachable paths removed (list with file:line).\n` +
    `**Consolidated** — Duplicate logic merged into shared modules (before→after mapping).\n` +
    `**Restructured** — Dependency changes, decoupling improvements, or pattern introductions.\n` +
    `**Behavior verification** — How existing behavior was confirmed preserved (tests run, manual checks).\n` +
    `**Risk notes** — Any areas where the refactoring carries residual risk (max 3 bullets).\n` +
    `Keep the report concise — bullets and short lines only. No narrative paragraphs.\n` +
    `</output_format>`,
};

export function registerCrucibleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", CARRIER_METADATA, { slot: 3, id: "crucible", displayName: "Crucible" });
}
