/**
 * core/agent/model-config.ts — 모델 선택 타입, 설정 영속화, 프로바이더 카탈로그
 *
 * model-selection/types.ts + store.ts + provider-catalog.ts 통합.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getProviderModels, getReasoningEffortLevels } from "@sbluemin/unified-agent";
import type { CliType } from "@sbluemin/unified-agent";

// ─── 타입 정의 ──────────────────────────────────────────

/** 각 CLI별 모델 선택 설정 */
export interface ModelSelection {
  /** 선택된 모델 ID */
  model: string;
  /** Direct 모드 사용 여부 (codex 전용, ACP 우회) */
  direct?: boolean;
  /** Reasoning effort (codex, claude — SDK의 reasoningEffort.levels 기반) */
  effort?: string;
  /** Claude thinking budget_tokens (effort가 none이 아닐 때 사용) */
  budgetTokens?: number;
}

/** selected-models.json 전체 구조 */
export type SelectedModelsConfig = Record<string, ModelSelection>;

/** 프로바이더 모델 정보 */
export interface ProviderInfo {
  name: string;
  defaultModel: string;
  models: Array<{ modelId: string; name: string }>;
  reasoningEffort: { supported: boolean; levels?: string[]; default?: string };
}

// ─── 상수 ──────────────────────────────────────────────

/** 저장 파일명 */
const SELECTED_MODELS_FILE = "selected-models.json";

/** effort 레벨별 기본 budget_tokens (Claude 전용) */
const CLAUDE_THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

// ─── 모델 설정 영속화 ──────────────────────────────────

/**
 * selected-models.json을 로드합니다.
 * 이전 형식(Record<string, string>)도 마이그레이션하여 반환합니다.
 */
export function loadSelectedModels(configDir: string): SelectedModelsConfig {
  try {
    const filePath = path.join(configDir, SELECTED_MODELS_FILE);
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null) return {};

    const result: SelectedModelsConfig = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") {
        // 이전 형식 마이그레이션: "codex": "gpt-5.4" → { model: "gpt-5.4" }
        result[key] = { model: value };
      } else if (typeof value === "object" && value !== null && "model" in value) {
        result[key] = value as ModelSelection;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * selected-models.json을 저장합니다.
 */
export function saveSelectedModels(configDir: string, config: SelectedModelsConfig): void {
  const filePath = path.join(configDir, SELECTED_MODELS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
}

// ─── 프로바이더 카탈로그 ────────────────────────────────

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
