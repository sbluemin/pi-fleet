/**
 * model-selection/provider-catalog.ts — 프로바이더 모델/추론 정보 조회
 *
 * @sbluemin/unified-agent SDK의 프로바이더 정보 래핑 유틸.
 */

import { getProviderModels, getReasoningEffortLevels } from "@sbluemin/unified-agent";
import type { CliType } from "@sbluemin/unified-agent";
import type { ProviderInfo } from "./types";

// ─── 상수 ──────────────────────────────────────────────

/** effort 레벨별 기본 budget_tokens (Claude 전용) */
const CLAUDE_THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

// ─── 프로바이더 정보 조회 ───────────────────────────────

/**
 * CLI에 대한 프로바이더 모델 정보를 반환합니다.
 * @sbluemin/unified-agent의 getProviderModels 래핑
 */
export function getAvailableModels(cli: CliType): ProviderInfo {
  return getProviderModels(cli) as ProviderInfo;
}

/**
 * CLI에 대한 reasoning effort 레벨 목록을 반환합니다.
 * 지원하지 않으면 null을 반환합니다.
 */
export function getEffortLevels(cli: CliType): string[] | null {
  return getReasoningEffortLevels(cli);
}

/**
 * effort 레벨에 대한 기본 budget_tokens를 반환합니다.
 */
export function getDefaultBudgetTokens(effort: string): number {
  return CLAUDE_THINKING_BUDGETS[effort] ?? 10000;
}
