/**
 * fleet/shipyard/squadron/prompts.ts — carrier_squadron 도구 프롬프트 / 스키마 관리
 *
 * carrier_squadron 도구 등록에 필요한 모든 프롬프트 메타데이터와
 * TypeBox 파라미터 스키마를 한 곳에서 조립합니다.
 */

import { Type, type TObject } from "@sinclair/typebox";
import { getRegisteredCarrierConfig } from "../carrier/framework.js";
import { SQUADRON_MAX_INSTANCES } from "./types.js";

// ─────────────────────────────────────────────────────────
// 1. 상수 프롬프트
// ─────────────────────────────────────────────────────────

/**
 * carrier_squadron 도구 설명 (Tool Schema — LLM이 도구 선택 시 참조).
 */
export const FLEET_SQUADRON_DESCRIPTION =
  `Fan out subtasks to parallel instances of the same carrier for divide-and-conquer execution.` +
  ` Split a single large task into independent subtasks and run them simultaneously on the chosen carrier.`;

/** carrier_squadron promptSnippet 기본값 */
const SQUADRON_PROMPT_SNIPPET =
  `carrier_squadron — Fan out subtasks to parallel instances of the same carrier.`;

/** whenToUse 가이드라인 */
const SQUADRON_WHEN_TO_USE =
  `Use carrier_squadron when a task can be decomposed into independent subtasks that benefit` +
  ` from parallel execution on the same carrier type. E.g., analyzing multiple files independently,` +
  ` running the same check across different modules, batch-processing items.`;

/** whenNotToUse 가이드라인 */
const SQUADRON_WHEN_NOT_TO_USE =
  `Do NOT use carrier_squadron for tasks requiring sequential/dependent execution — use carriers_sortie` +
  ` for serial delegation. Do not use for cross-model comparison — use carrier_taskforce instead.` +
  ` Do not use when subtasks have data dependencies on each other.`;

const SQUADRON_CONFIGURE_HINT =
  `open Carrier Status (Alt+O) and press S to enable squadron mode for a carrier`;

/** 기본 가이드라인 항목 목록 */
const SQUADRON_BASE_GUIDELINES: string[] = [
  SQUADRON_WHEN_TO_USE,
  SQUADRON_WHEN_NOT_TO_USE,
  `The carrier parameter selects which carrier to fan out.` +
  ` All instances inherit the base carrier's persona, model, and settings.`,
  `expected_subtask_count must exactly match the subtasks array length — mismatches cause a hard error.` +
  ` Maximum ${SQUADRON_MAX_INSTANCES} subtasks allowed.`,
  `PI splits the task into subtasks — the tool only fans out execution.` +
  ` Results are returned in structured format; final interpretation is PI's responsibility.`,
];

// ─────────────────────────────────────────────────────────
// 2. Build 함수
// ─────────────────────────────────────────────────────────

/** carrier_squadron의 `promptSnippet` 값을 반환합니다. */
export function buildSquadronPromptSnippet(): string {
  return SQUADRON_PROMPT_SNIPPET;
}

/**
 * carrier_squadron의 `promptGuidelines` 배열을 반환합니다.
 *
 * @param enabledCarrierIds squadron 활성 carrier ID 목록
 */
export function buildSquadronPromptGuidelines(enabledCarrierIds: string[]): string[] {
  return [...SQUADRON_BASE_GUIDELINES, ...buildCarrierRoster(enabledCarrierIds)];
}

/**
 * carrier_squadron의 TypeBox `parameters` 스키마를 반환합니다.
 *
 * @param enabledCarrierIds squadron 활성 carrier ID 목록
 */
export function buildSquadronSchema(enabledCarrierIds: string[]): TObject {
  const availableDesc =
    enabledCarrierIds.length > 0
      ? `Squadron target carrier ID. Available: ${enabledCarrierIds.join(", ")}`
      : `Squadron target carrier ID. (No carriers currently enabled for Squadron — ${SQUADRON_CONFIGURE_HINT})`;

  return Type.Object({
    carrier: Type.String({ description: availableDesc }),
    expected_subtask_count: Type.Number({
      description: `Number of subtasks (must match subtasks array length). Max ${SQUADRON_MAX_INSTANCES}.`,
      minimum: 1,
      maximum: SQUADRON_MAX_INSTANCES,
    }),
    subtasks: Type.Array(
      Type.Object({
        title: Type.String({ description: "서브태스크 식별명" }),
        request: Type.String({ description: "개별 요청" }),
      }),
      { minItems: 1, maxItems: SQUADRON_MAX_INSTANCES },
    ),
  });
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

/** squadron 활성 carrier 로스터 생성 */
function buildCarrierRoster(carrierIds: string[]): string[] {
  if (carrierIds.length === 0) {
    return [
      `## Squadron Carriers\nNo carriers are currently enabled for Squadron.` +
      ` To enable, ${SQUADRON_CONFIGURE_HINT}.`,
    ];
  }

  const lines: string[] = [];
  lines.push(`## Available Carriers for Squadron`);

  for (const carrierId of carrierIds) {
    const config = getRegisteredCarrierConfig(carrierId);
    if (!config) continue;

    const meta = config.carrierMetadata;
    if (!meta) {
      lines.push(`- **${carrierId}** (${config.displayName}): Uses ${config.displayName}'s role.`);
      continue;
    }

    lines.push(`- **${carrierId}** (${config.displayName} · ${meta.title}): ${meta.summary}`);
    lines.push(`  Use for: ${meta.whenToUse.join(", ")}.`);
  }

  return [lines.join("\n")];
}
