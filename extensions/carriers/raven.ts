/**
 * carriers/raven — Raven carrier (CVN-05)
 * @specialization 레드팀 커맨더 — 침투 테스트(Red Teaming) 및 보안 취약점 감사 특화
 *
 * Raven carrier를 프레임워크에 등록합니다 (alt+5, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Red Team Commander",
  summary: "Security specialist — penetration testing, vulnerability audits, defense hardening.",
  whenToUse: [
    "security audits",
    "penetration testing",
    "vulnerability hunting",
    "dependency risk analysis",
  ],
  whenNotToUse: "before implementation (genesis→crucible) is done. General QA (→sentinel), new features (→genesis), refactoring (→crucible)",

  // ── Tier 2: Composition ──
  permissions: [
    "CRITICAL: Strictly read-only. NEVER delegate code modification or file editing to this carrier.",
    "Full access to read the codebase and execute read-only commands for analysis.",
  ],
  requestBlocks: [
    { tag: "target", hint: "Which files, endpoints, modules, or flows to audit for security.", required: true },
    { tag: "attack_surface", hint: "Known entry points, user-controlled inputs, or external interfaces.", required: false },
    { tag: "threat_model", hint: "Assumed attacker capability — unauth user, compromised dep, insider.", required: false },
    { tag: "fix_mode", hint: "'report' only — read-only carrier, no patches applied.", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `Report findings as a structured security assessment:\n` +
    `For each vulnerability, use this format:\n` +
    `- **[SEVERITY]** (critical/high/medium/low) **file:line** — Vulnerability class (e.g., XSS, SSRF)\n` +
    `  - Attack vector: how an attacker exploits this\n` +
    `  - Impact: what is compromised (data, access, availability)\n` +
    `  - Proof of concept: minimal exploit scenario or payload sketch\n` +
    `  - Mitigation: specific defensive code or configuration change\n` +
    `Group findings by severity (critical first).\n` +
    `End with:\n` +
    `**Threat summary** — Total count by severity. Overall security posture in 1-2 sentences.\n` +
    `**Dependency risks** — Any vulnerable transitive dependencies found (if scanned).\n` +
    `</output_format>`,
};

export function registerRavenCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", CARRIER_METADATA, { slot: 5, id: "raven", displayName: "Raven" });
}
