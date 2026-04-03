/**
 * fleet/carrier/prompts.ts — carrier_sortie 도구 프롬프트 관리
 *
 * carrier_sortie 도구의 기본 프롬프트 텍스트와
 * 등록된 carrier 기반 동적 프롬프트 합성 로직을 정의합니다.
 */

import { getRegisteredCarrierConfig } from "./framework.js";

/**
 * 병렬 작업 환경 경고 guideline.
 */
export function buildParallelWorkGuideline(): string {
  return (
    `Multiple agents may be working on this codebase at the same time on a single filesystem and branch.` +
    ` Only touch changes you made — never revert or overwrite modifications made by others.` +
    ` Prefer precise edits (edit) over full-file writes (write).` +
    ` Always re-read a file before modifying it, as it may have changed since your last read.`
  );
}

// ─── carrier_sortie 도구 프롬프트 ─────────────────────────

/** carrier_sortie 도구 설명 (LLM이 도구 선택 시 참조) */
export const FLEET_SORTIE_DESCRIPTION =
  `Launch carriers for task execution — single or parallel.` +
  ` This is the only tool for delegating tasks to carrier agents.` +
  ` Use it whenever you want to delegate implementation, analysis, exploration, or any coding task to one or more carriers.`;

/** carrier_sortie promptSnippet (시스템 프롬프트 Available tools 섹션) */
export const FLEET_SORTIE_PROMPT_SNIPPET =
  `carrier_sortie — Launch 1+ carriers for task delegation. The sole carrier delegation tool.`;

/** carrier_sortie promptGuidelines 기본 항목 (시스템 프롬프트 Guidelines 섹션) */
export const FLEET_SORTIE_PROMPT_GUIDELINES: string[] = [
  `carrier_sortie is the only way to delegate tasks to carrier agents.` +
  ` Always use this tool — never attempt to invoke carriers directly.`,
  `You can launch a single carrier or multiple carriers in parallel.` +
  ` When launching multiple carriers, this tool provides unified progress tracking and a consolidated result view.`,
  buildParallelWorkGuideline(),
];

/**
 * 등록된 carrier들의 프롬프트 메타데이터를 읽어
 * sortie promptGuidelines에 합성할 가이드라인을 생성합니다.
 */
export function buildCarrierGuidelines(carrierIds: string[]): string[] {
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

  // 전체를 하나의 guideline 문자열로 합침 (PI가 guidelines를 배열로 렌더링)
  return [lines.join("\n")];
}
