/**
 * fleet/shipyard/taskforce/prompts.ts — carrier_taskforce 도구 프롬프트 / 스키마 관리
 *
 * carrier_taskforce 도구 등록에 필요한 모든 프롬프트 메타데이터와
 * TypeBox 파라미터 스키마를 한 곳에서 조립합니다.
 */

import { Type, type TObject } from "@sinclair/typebox";
import { getRegisteredCarrierConfig } from "../carrier/framework.js";

// ─────────────────────────────────────────────────────────
// 1. 상수 프롬프트
// ─────────────────────────────────────────────────────────

/**
 * carrier_taskforce 도구 설명 (Tool Schema — LLM이 도구 선택 시 참조).
 */
export const FLEET_TASKFORCE_DESCRIPTION =
  `Cross-validate a carrier's response across all CLI backends (Claude, Codex, Gemini) simultaneously.` +
  ` Runs the same task under the chosen carrier's persona on every backend and returns a consolidated comparison.` +
  ` Use this when you need to compare approaches, detect blind spots, or build consensus across models.`;

/** carrier_taskforce promptSnippet 기본값 */
const TASKFORCE_PROMPT_SNIPPET =
  `carrier_taskforce — Run a carrier's persona on all CLI backends simultaneously for cross-validation.`;

/** whenToUse 가이드라인 */
const TASKFORCE_WHEN_TO_USE =
  `Use carrier_taskforce when cross-model validation is needed: comparing solution approaches,` +
  ` catching model-specific blind spots, building consensus, or when a single backend may be insufficient.` +
  ` Pick the carrier whose role/persona best fits the task.`;

/** whenNotToUse 가이드라인 */
const TASKFORCE_WHEN_NOT_TO_USE =
  `Do NOT use carrier_taskforce for routine single-backend tasks — use carrier_sortie instead.` +
  ` Avoid it when only one backend is needed or when execution speed is critical.` +
  ` Do not use as a substitute for carrier_sortie with multiple carriers.`;

/** 기본 가이드라인 항목 목록 */
const TASKFORCE_BASE_GUIDELINES: string[] = [
  TASKFORCE_WHEN_TO_USE,
  TASKFORCE_WHEN_NOT_TO_USE,
  `The carrier parameter selects which carrier's role and prompt context to apply.` +
  ` All three CLI backends (Claude, Codex, Gemini) will execute the same request under that carrier's persona.`,
  `Results are returned as a consolidated comparison: [Claude] (status), [Codex] (status), [Gemini] (status).` +
  ` Each backend runs independently — a failure in one does not abort the others.`,
];

// ─────────────────────────────────────────────────────────
// 2. Build 함수
// ─────────────────────────────────────────────────────────

/** carrier_taskforce의 `promptSnippet` 값을 반환합니다. */
export function buildTaskForcePromptSnippet(): string {
  return TASKFORCE_PROMPT_SNIPPET;
}

/**
 * carrier_taskforce의 `promptGuidelines` 배열을 반환합니다.
 *
 * @param configuredCarrierIds TF 설정이 완전히 구성된 carrier ID 목록
 */
export function buildTaskForcePromptGuidelines(configuredCarrierIds: string[]): string[] {
  return [...TASKFORCE_BASE_GUIDELINES, ...buildCarrierRoster(configuredCarrierIds)];
}

/**
 * carrier_taskforce의 TypeBox `parameters` 스키마를 반환합니다.
 *
 * @param configuredCarrierIds TF 설정이 완전히 구성된 carrier ID 목록
 */
export function buildTaskForceSchema(configuredCarrierIds: string[]): TObject {
  const availableDesc =
    configuredCarrierIds.length > 0
      ? `Carrier ID whose persona to apply. Available: ${configuredCarrierIds.join(", ")}`
      : `Carrier ID whose persona to apply. (No carriers currently configured for Task Force — open Carrier Status (Alt+O) and press T to configure)`;

  return Type.Object({
    carrier: Type.String({ description: availableDesc }),
    request: Type.String({
      description: "The task/prompt to cross-validate across all CLI backends",
    }),
  });
}

// ─────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────

/** 구성 완료된 carrier 로스터 생성 */
function buildCarrierRoster(carrierIds: string[]): string[] {
  if (carrierIds.length === 0) {
    return [
      `## Task Force Carriers\nNo carriers are currently fully configured for Task Force.` +
      ` To configure, open Carrier Status (Alt+O), select a carrier, and press T to set up all three CLI backends (Claude, Codex, Gemini).`,
    ];
  }

  const lines: string[] = [];
  lines.push(`## Available Carriers for Task Force`);

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
