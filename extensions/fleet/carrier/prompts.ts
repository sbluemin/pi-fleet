/**
 * fleet/carrier/prompts.ts — Carrier 도구 프롬프트 정제
 *
 * carrier가 보유한 도구 프롬프트 원본을 받아,
 * Fleet/PI 호스트 관점의 최소 컨텍스트만 덧붙여 정제합니다.
 */

export interface SingleCarrierToolMetadata {
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
}

interface RefineToolPromptOptions {
  displayName: string;
  metadata: SingleCarrierToolMetadata;
}

/**
 * Fleet 컨텍스트 guideline을 생성합니다.
 *
 * "selected CLI" 같은 모호한 표현 대신 구체적 carrier 이름을 삽입하여
 * PI가 각 carrier를 명확히 구분할 수 있도록 합니다.
 */
function buildFleetContextGuideline(displayName: string): string {
  return (
    `This tool operates as the ${displayName} carrier within PI's fleet` +
    ` — a dedicated delegation channel, not a standalone CLI invocation.` +
    ` Delegate implementation, analysis, and exploration tasks to this tool` +
    ` rather than handling them directly with read/edit/bash.`
  );
}

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** 공백 정규화 기준으로 중복 guideline을 제거합니다. */
function dedupeGuidelines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(line.trim());
  }

  return result;
}

/**
 * carrier 등록 시 PI가 호스트/사령관 맥락을 인지할 수 있도록
 * 도구 프롬프트를 최소 범위로 정제합니다.
 *
 * - description, promptSnippet: caller 원본 보존 (수정 없음)
 * - promptGuidelines: fleet 컨텍스트 1줄을 맨 앞에 prepend
 */
export function refineSingleCarrierToolMetadata({
  displayName,
  metadata,
}: RefineToolPromptOptions): SingleCarrierToolMetadata {
  const promptGuidelines = dedupeGuidelines([
    buildFleetContextGuideline(displayName),
    ...metadata.promptGuidelines,
  ]);

  return {
    description: metadata.description,
    promptSnippet: metadata.promptSnippet,
    promptGuidelines,
  };
}
