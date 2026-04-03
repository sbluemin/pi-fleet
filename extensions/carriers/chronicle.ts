/**
 * carriers/chronicle — Chronicle carrier (CVN-08)
 * @specialization 수석 기록참모 — API 명세서·README·PR 요약 등 기술 문서 작성 특화
 *
 * Chronicle carrier를 프레임워크에 등록합니다 (alt+8, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CarrierMetadata } from "../fleet/shipyard/carrier/types.js";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const CARRIER_METADATA: CarrierMetadata = {
  // ── Tier 1: Routing ──
  title: "Chief Knowledge Officer",
  summary: "Tech writer — API specs, README, PR summaries, release notes, changelogs.",
  whenToUse: [
    "documentation creation or update",
    "PR summaries and changelogs",
    "release note compilation",
    "API specification generation (OpenAPI/Swagger)",
  ],
  whenNotToUse: "code implementation (→genesis), code review (→sentinel), architecture decisions (→oracle)",

  // ── Tier 2: Composition ──
  permissions: [
    "Writes documentation files only — must NOT modify source code logic (report issues instead).",
    "Full access to the codebase — read, write, and execute commands.",
  ],
  requestBlocks: [
    { tag: "target", hint: "Which code, module, PR, or feature to document.", required: true },
    { tag: "doc_type", hint: "README, API spec, PR summary, release notes, changelog, etc.", required: true },
    { tag: "audience", hint: "developers, end-users, API consumers, or contributors.", required: true },
    { tag: "scope", hint: "What to include/exclude. Commit range for changelogs.", required: false },
  ],
  outputFormat:
    `<output_format>\n` +
    `Deliver the documentation artifact directly — write it to the appropriate file(s).\n` +
    `After writing, provide a brief completion report:\n` +
    `**Documents written** — List each file created/modified with its path and doc type.\n` +
    `**Coverage** — What was documented and any gaps noted.\n` +
    `**Style notes** — Any conventions followed or decisions about tone/structure (max 3 bullets).\n` +
    `**Spotted issues** — Code issues noticed during documentation that should be reported to other carriers (if any).\n` +
    `Keep the completion report concise — the documentation itself is the primary deliverable.\n` +
    `</output_format>`,
};

export function registerChronicleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", CARRIER_METADATA, { slot: 8, id: "chronicle", displayName: "Chronicle" });
}
