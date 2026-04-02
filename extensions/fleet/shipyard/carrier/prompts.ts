/**
 * fleet/carrier/prompts.ts — carrier_sortie 도구 프롬프트 관리
 *
 * carrier_sortie 도구의 기본 프롬프트 텍스트를 정의합니다.
 * 등록된 carrier들의 역할 설명은 sortie.ts에서 동적으로 합성합니다.
 */

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
