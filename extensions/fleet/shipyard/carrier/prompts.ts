/**
 * fleet/carrier/prompts.ts — carrier_sortie 도구 프롬프트 / 스키마 관리
 *
 * carrier_sortie 도구 등록에 필요한 모든 프롬프트 메타데이터와
 * TypeBox 파라미터 스키마를 한 곳에서 조립합니다.
 *
 * 구조:
 *  1. 상수 프롬프트          — LLM에 노출되는 고정 텍스트
 *  2. buildSortieToolPromptSnippet    — Available tools 섹션 한 줄
 *  2. buildSortieToolPromptGuidelines — Guidelines 섹션 bullets (동적 carrier 목록 포함)
 *  2. buildSortieToolSchema           — TypeBox parameters 스키마
 */

import { Type, type TObject } from "@sinclair/typebox";
import { getRegisteredCarrierConfig } from "./framework.js";

// ─────────────────────────────────────────────────────────
// 공유 타입
// ─────────────────────────────────────────────────────────

/** carrier_sortie 도구의 단일 carrier 배정 항목 */
export interface CarrierAssignment {
  carrier: string;
  request: string;
}

// ─────────────────────────────────────────────────────────
// 1. 상수 프롬프트
// ─────────────────────────────────────────────────────────

/**
 * carrier_sortie 도구 설명 (Tool Schema — LLM이 도구 선택 시 참조).
 * registerTool의 `description` 필드에 전달됩니다.
 */
export const FLEET_SORTIE_DESCRIPTION =
  `Launch carriers for task execution — single or parallel.` +
  ` This is the only tool for delegating tasks to carrier agents.` +
  ` Use it whenever you want to delegate implementation, analysis, exploration, or any coding task to one or more carriers.`;

/**
 * carrier_sortie promptSnippet 기본값.
 * 시스템 프롬프트 "Available tools" 섹션의 한 줄 요약.
 */
const SORTIE_PROMPT_SNIPPET =
  `carrier_sortie — Launch 1+ carriers for task delegation. The sole carrier delegation tool.`;

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
  ` If you need two different workloads of the same type, split the work between two different carriers.`;

/**
 * 병렬 출격 시 누락 방지 규칙 — 계획한 모든 carrier를 단일 carrier_sortie 호출의
 * carriers 배열에 빠짐없이 포함해야 한다. 분리된 tool call로 나누지 말 것.
 */
const SORTIE_COMPLETENESS_GUIDELINE =
  `When planning a parallel launch, ALL intended carriers MUST be listed together in the carriers array of a SINGLE carrier_sortie call.` +
  ` Do NOT split a planned parallel operation into separate sequential calls.` +
  ` Before submitting the call, mentally verify: every carrier you planned is present in the carriers array.` +
  ` A carrier omitted from the array will silently not be launched — there is no automatic retry.`;

/**
 * carrier_sortie promptGuidelines 고정 항목.
 * 시스템 프롬프트 "Guidelines" 섹션의 기본 bullets.
 */
const SORTIE_BASE_GUIDELINES: string[] = [
  `carrier_sortie is the only way to delegate tasks to carrier agents.` +
  ` Always use this tool — never attempt to invoke carriers directly.`,
  `You can launch a single carrier or multiple carriers in parallel.` +
  ` When launching multiple carriers, this tool provides unified progress tracking and a consolidated result view.`,
  SORTIE_DEDUP_GUIDELINE,
  SORTIE_COMPLETENESS_GUIDELINE,
  SORTIE_PARALLEL_WORK_GUIDELINE,
];

// ─────────────────────────────────────────────────────────
// 2. Build 함수
// ─────────────────────────────────────────────────────────

/**
 * carrier_sortie의 `promptSnippet` 값을 반환합니다.
 * 시스템 프롬프트 "Available tools" 섹션에 한 줄로 표시됩니다.
 */
export function buildSortieToolPromptSnippet(): string {
  return SORTIE_PROMPT_SNIPPET;
}

/**
 * carrier_sortie의 `promptGuidelines` 배열을 반환합니다.
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
 * carrier_sortie의 TypeBox `parameters` 스키마를 반환합니다.
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
        description: "Array of carrier assignments (1 or more)",
      },
    ),
  });
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

/**
 * 등록된 carrier들의 프롬프트 메타데이터를 읽어
 * "## Available Carriers" 블록을 포함한 guideline 배열을 반환합니다.
 */
function buildCarrierGuidelines(carrierIds: string[]): string[] {
  const lines: string[] = [];
  lines.push(`## Available Carriers`);

  for (const carrierId of carrierIds) {
    const config = getRegisteredCarrierConfig(carrierId);
    if (!config) continue;

    const name = config.displayName;
    const desc = config.carrierDescription ?? `Delegate tasks to ${name}.`;
    lines.push(`- **${carrierId}** (${name}): ${desc}`);

    // carrier 고유 가이드라인이 있으면 하위 항목으로 추가
    if (config.carrierPromptGuidelines?.length) {
      for (const gl of config.carrierPromptGuidelines) {
        lines.push(`  - ${gl}`);
      }
    }
  }

  // 전체를 하나의 문자열로 합침 (PI가 guidelines를 배열로 렌더링)
  return [lines.join("\n")];
}
