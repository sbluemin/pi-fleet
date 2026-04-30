import { getProviderModels, getReasoningEffortLevels } from "@sbluemin/unified-agent";
import type { CliType } from "@sbluemin/unified-agent";

/** 프로바이더 모델 정보 */
export interface ProviderInfo {
  name: string;
  defaultModel: string;
  models: Array<{ modelId: string; name: string }>;
  reasoningEffort: { supported: boolean; levels?: string[]; default?: string };
}

/** effort 레벨별 기본 budget_tokens (Claude 전용) */
const CLAUDE_THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

/**
 * CLI에 대한 프로바이더 모델 정보를 반환합니다.
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
