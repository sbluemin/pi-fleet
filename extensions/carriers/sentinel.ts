/**
 * carriers/sentinel — Sentinel carrier (CVN-04)
 * @specialization 인퀴지터 (QA 리드) — 숨겨진 버그 탐지 및 코드 품질 검사 특화
 *
 * Sentinel carrier를 프레임워크에 등록합니다 (alt+4, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "The Inquisitor / QA Lead",
  summary: "Bug hunter — code review, defect detection, quality audits with ruthless precision.",
  whenToUse: [
    "code review",
    "bug hunting",
    "quality audits",
    "test execution",
    "debugging and root-cause investigation",
  ],
  whenNotToUse: "before implementation (genesis→crucible) is done. Security pentesting (→raven), new features (→genesis), refactoring (→crucible)",

  // ── Tier 2: Composition ──
  permissions: [
    "Primary mode is detection and reporting — defaults to report-only. May apply fixes when explicitly instructed.",
    "Full access to the codebase — read, write, and execute commands.",
  ],
  requestBlocks: [
    { tag: "target", hint: "Which files, modules, PRs, or recent changes to inspect.", required: true },
    { tag: "concern", hint: "Specific suspicion, symptom, or area of worry to focus on.", required: false },
    { tag: "context", hint: "Background on what the code does and expected behavior.", required: false },
    { tag: "fix_mode", hint: "'report' (default) for findings only, or 'fix' to apply corrections.", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `Report findings as a structured defect manifest:\n` +
    `For each finding, use this format:\n` +
    `- **[SEVERITY]** (critical/high/medium/low) **file:line** — 1-line description\n` +
    `  - Evidence: what proves this is a real issue\n` +
    `  - Impact: what breaks or degrades if unfixed\n` +
    `  - Suggested fix: concrete remediation (1-2 lines)\n` +
    `Group findings by severity (critical first).\n` +
    `End with:\n` +
    `**Summary** — Total count by severity. Overall quality assessment in 1-2 sentences.\n` +
    `**Verdict** — PASS (no critical/high) or FAIL (critical/high found) with brief justification.\n` +
    `</output_format>`,
};

export function registerSentinelCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", CARRIER_METADATA, { slot: 4, id: "sentinel", displayName: "Sentinel" });
}
