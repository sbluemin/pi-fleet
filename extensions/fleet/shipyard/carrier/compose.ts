/**
 * fleet/carrier/compose.ts — Tier 2 request 조립 유틸리티
 *
 * composeTier2Request: carrier 메타데이터의 permissions + principles + outputFormat을
 * 원본 request에 주입하여 최종 request를 조립합니다.
 *
 * register.ts 및 taskforce/taskforce.ts 양쪽에서 재사용합니다.
 */

import type { CarrierMetadata } from "./types.js";

// ─── 공개 API ────────────────────────────────────────────

/**
 * Tier 2 자동 주입: permissions + principles를 앞에, outputFormat을 끝에 붙여
 * 최종 request를 조립합니다.
 */
export function composeTier2Request(metadata: CarrierMetadata, originalRequest: string): string {
  const directives = [
    buildDirectiveSection("## Permissions & Constraints", metadata.permissions),
    buildDirectiveSection("## Principles", metadata.principles ?? []),
  ].filter((section) => section.length > 0);

  const parts: string[] = [];
  if (directives.length > 0) {
    parts.push(directives.map((section) => section.join("\n")).join("\n\n") + "\n\n---\n");
  }
  parts.push(originalRequest);

  if (metadata.outputFormat) {
    parts.push("\n" + metadata.outputFormat);
  }

  return parts.join("\n");
}

function buildDirectiveSection(title: string, items: string[]): string[] {
  if (items.length === 0) return [];

  return [
    title,
    ...items.map((item) => `- ${item}`),
  ];
}
