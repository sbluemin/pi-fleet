/**
 * fleet/carrier/prompts.ts — carriers_sortie 프롬프트 / 스키마 관리 (Tier 1 · Tier 2)
 *
 * Tier 1: carriers_sortie 도구 등록에 필요한 프롬프트 메타데이터와 TypeBox 파라미터 스키마.
 * Tier 2: carrier 메타데이터(permissions, principles, outputFormat)를 원본 request에
 *         주입하여 최종 request를 조립하는 유틸리티.
 *
 * 구조:
 *  Tier 1 — 상수 프롬프트 / build 함수 / 내부 헬퍼
 *  Tier 2 — composeTier2Request / buildDirectiveSection
 */

import { Type, type TObject } from "@sinclair/typebox";
import { getRegisteredCarrierConfig } from "./framework.js";
import type { CarrierMetadata } from "./types.js";

// ═════════════════════════════════════════════════════════
// Tier 1 — carriers_sortie 도구 프롬프트 / 스키마
// ═════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// 공유 타입
// ─────────────────────────────────────────────────────────

/** carriers_sortie 도구의 단일 carrier 배정 항목 */
export interface CarrierAssignment {
  carrier: string;
  request: string;
}

// ─────────────────────────────────────────────────────────
// 1. 상수 프롬프트
// ─────────────────────────────────────────────────────────

/**
 * carriers_sortie 도구 설명 (Tool Schema — LLM이 도구 선택 시 참조).
 * registerTool의 `description` 필드에 전달됩니다.
 */
export const FLEET_SORTIE_DESCRIPTION =
  `Launch carriers for task execution — single or multiple(parallel).` +
  ` This is the only tool for delegating tasks to carrier agents.` +
  ` Use it whenever you want to delegate implementation, analysis, exploration, or any coding task to one or more carriers.` +
  ` Always bundle all intended carriers into one call — never split a parallel batch into multiple sequential calls.`;

/**
 * carriers_sortie promptSnippet 기본값.
 * 시스템 프롬프트 "Available tools" 섹션의 한 줄 요약.
 */
const SORTIE_PROMPT_SNIPPET =
  `carriers_sortie — Launch 1+ carriers for task delegation. The sole carrier delegation tool.`;

/**
 * 병렬 작업 환경 경고 — sortie promptGuidelines에 삽입됩니다.
 * (fleet/prompts의 PARALLEL_WORK_WARNING은 시스템 프롬프트 전체 섹션용이며,
 *  이쪽은 도구 Guidelines bullet 한 항목용으로 별도 유지됩니다.)
 */
const SORTIE_PARALLEL_WORK_GUIDELINE =
  `Multiple agents may be working on this codebase at the same time on a single filesystem and branch.` +
  ` Only touch changes you made — never revert or overwrite modifications made by others.` +
  ` Prefer precise edits (edit) over full-file writes (write).` +
  ` Always re-read a file before modifying it, as it may have changed since your last read.`;

/**
 * 중복 carrier 금지 규칙 — 동일 carrier ID를 carriers 배열에 2회 이상 등록하면
 * 시스템이 즉시 에러를 반환하며 전체 sortie가 실패한다.
 */
const SORTIE_DEDUP_GUIDELINE =
  `Each carrier ID may appear at most once per carriers_sortie call.` +
  ` Duplicate carrier IDs in the same call are rejected by the system and cause the entire sortie to fail.` +
  ` If you need two different workloads handled by carriers of the same type, assign each to a different carrier ID within the same call's carriers array.`;

/**
 * 병렬 출격 시 누락 방지 규칙 — 계획한 모든 carrier를 단일 carriers_sortie 호출의
 * carriers 배열에 빠짐없이 포함해야 한다. 분리된 tool call로 나누지 말 것.
 */
const SORTIE_COMPLETENESS_GUIDELINE =
  `carriers_sortie requires an expected_carrier_count field that MUST be set BEFORE filling the carriers array.` +
  ` Decide the total number of carriers you plan to launch first, write that number into expected_carrier_count, then fill the carriers array to match.` +
  ` The system will immediately hard-error if expected_carrier_count does not equal the actual carriers array length — the call will be rejected and you must resubmit with the correct count and all intended carriers.` +
  ` If a previous carriers_sortie call failed, retry with ALL originally intended carriers if the cause was a validation error or transient issue; if an inactive or unregistered carrier caused the failure, review alternatives or request Fleet Admiral clarification instead.`;

/**
 * carriers_sortie promptGuidelines 고정 항목.
 * 시스템 프롬프트 "Guidelines" 섹션의 기본 bullets.
 */
const SORTIE_BASE_GUIDELINES: string[] = [
  SORTIE_COMPLETENESS_GUIDELINE,
  `carriers_sortie is the only way to delegate tasks to carrier agents.` +
  ` Always use this tool — never attempt to invoke carriers directly.`,
  `You can launch a single carrier or multiple carriers in parallel — when launching multiple carriers, you MUST include all of them in a single carriers_sortie call.` +
  ` This tool provides unified progress tracking and a consolidated result view.`,
  `When composing a carrier request, provide only background, context, objective, and constraints.` +
  ` Do NOT prescribe implementation details or step-by-step instructions — trust the carrier's own reasoning.` +
  ` Use the Tags listed for each carrier to structure your request.`,
  SORTIE_DEDUP_GUIDELINE,
  SORTIE_PARALLEL_WORK_GUIDELINE,
];

// ─────────────────────────────────────────────────────────
// 2. Build 함수
// ─────────────────────────────────────────────────────────

/**
 * carriers_sortie의 `promptSnippet` 값을 반환합니다.
 * 시스템 프롬프트 "Available tools" 섹션에 한 줄로 표시됩니다.
 */
export function buildSortieToolPromptSnippet(): string {
  return SORTIE_PROMPT_SNIPPET;
}

/**
 * carriers_sortie의 `promptGuidelines` 배열을 반환합니다.
 *
 * 고정 3개 항목 + 등록된 carrier별 설명을 동적으로 합산하여
 * 시스템 프롬프트 "Guidelines" 섹션에 주입될 최종 배열을 구성합니다.
 *
 * @param carrierIds sortie 가능한 carrier ID 목록
 */
export function buildSortieToolPromptGuidelines(carrierIds: string[]): string[] {
  return [...SORTIE_BASE_GUIDELINES, ...buildCarrierGuidelines(carrierIds)];
}

/**
 * carriers_sortie의 TypeBox `parameters` 스키마를 반환합니다.
 *
 * enabledIds를 기반으로 `carrier` 파라미터의 description을 동적으로 조합하여
 * LLM이 가용한 carrier ID를 정확히 파악할 수 있도록 합니다.
 *
 * @param enabledIds sortie 가능한 carrier ID 목록
 */
export function buildSortieToolSchema(enabledIds: string[]): TObject {
  const availableDesc =
    enabledIds.length > 0
      ? `Carrier ID to sortie. Available: ${enabledIds.join(", ")}`
      : `Carrier ID to sortie. (No carriers currently available)`;

  return Type.Object({
    expected_carrier_count: Type.Integer({
      minimum: 1,
      description:
        "Number of carriers you intend to launch in this call. " +
        "Set this FIRST before composing the carriers array. " +
        "Must exactly equal the length of the carriers array — a mismatch is a hard error and the call will be rejected.",
    }),
    carriers: Type.Array(
      Type.Object({
        carrier: Type.String({
          description: availableDesc,
        }),
        request: Type.String({
          description: "The task/prompt to send to this carrier",
        }),
      }),
      {
        minItems: 1,
        description:
          "Array of carrier assignments. Length must equal expected_carrier_count. " +
          "When launching multiple carriers in parallel, ALL intended carriers MUST be listed together here in a SINGLE call — never split a parallel batch into multiple sequential calls. " +
          "Example (single): [{\"carrier\": \"genesis\", \"request\": \"...\"}] " +
          "Example (parallel): [{\"carrier\": \"sentinel\", \"request\": \"...\"}, {\"carrier\": \"raven\", \"request\": \"...\"}] " +
          "MUST be a native JSON array [...], NOT a stringified JSON string.",
      },
    ),
  });
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

/**
 * 등록된 carrier들의 CarrierMetadata를 읽어
 * "## Available Carriers" compact roster를 생성합니다.
 *
 * carrier당 ~4줄로 압축하여 시스템 프롬프트 토큰을 절약합니다.
 * (기존 ~180줄 → ~36줄)
 */
function buildCarrierGuidelines(carrierIds: string[]): string[] {
  const lines: string[] = [];
  lines.push(`## Available Carriers`);

  for (const carrierId of carrierIds) {
    const config = getRegisteredCarrierConfig(carrierId);
    if (!config) continue;

    const meta = config.carrierMetadata;
    if (!meta) {
      // 메타데이터 없는 carrier는 기본 1줄 표시
      lines.push(`- **${carrierId}** (${config.displayName}): Delegate tasks to ${config.displayName}.`);
      continue;
    }

    const name = config.displayName;
    // 1줄: carrier ID, 표시명, 직함, 요약
    lines.push(`- **${carrierId}** (${name} · ${meta.title}): ${meta.summary}`);
    // 2줄: 긍정 호출 조건
    lines.push(`  Use for: ${meta.whenToUse.join(", ")}.`);
    // 3줄: 부정 조건
    lines.push(`  NOT for: ${meta.whenNotToUse}`);
    // 4줄: 요청 블록 태그 (required는 그대로, optional은 ?로 표시)
    if (meta.requestBlocks.length > 0) {
      const tags = meta.requestBlocks
        .map((b) => b.required ? `<${b.tag}>` : `<${b.tag}?>`)
        .join(" ");
      lines.push(`  Tags: ${tags}`);
    }
  }

  // 전체를 하나의 문자열로 합침 (PI가 guidelines를 배열로 렌더링)
  return [lines.join("\n")];
}

// ═════════════════════════════════════════════════════════
// Tier 2 — request 조립 (permissions · principles · outputFormat 주입)
// ═════════════════════════════════════════════════════════

/**
 * Tier 2 자동 주입: 원본 request를 최상단에, permissions + principles를
 * 보조 컨텍스트로, outputFormat을 최하단에 배치하여 최종 request를 조립합니다.
 *
 * 주입 순서 (LLM의 primacy bias 활용):
 *  1. Original Request (가장 중요 — 최상단)
 *  2. Operational Context: Permissions & Constraints + Principles (보조)
 *  3. Output Format (구조 가이드 — 최하단)
 */
export function composeTier2Request(metadata: CarrierMetadata, originalRequest: string): string {
  const parts: string[] = [];

  // 1. 원본 요청을 최상단에 배치 — Carrier가 의도를 먼저 파악
  parts.push(originalRequest);

  // 2. 운영 컨텍스트 (permissions, principles)를 보조 섹션으로
  const directives = [
    buildDirectiveSection("## Permissions & Constraints", metadata.permissions),
    buildDirectiveSection("## Principles", metadata.principles ?? []),
  ].filter((section) => section.length > 0);

  if (directives.length > 0) {
    parts.push("\n---\n\n" + directives.map((section) => section.join("\n")).join("\n\n"));
  }

  // 3. 출력 형식 가이드를 최하단에
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
