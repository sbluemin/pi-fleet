/**
 * fleet/internal/agent/model-config.ts — 모델 선택 타입, 설정 영속화, 프로바이더 카탈로그
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
  /** Task Force 백엔드별 커스텀 설정 (cliType → 모델 선택) */
  taskforce?: TaskForceConfig;
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

type TaskForceCliType = "claude" | "codex" | "gemini";
type TaskForceSelection = Omit<ModelSelection, "taskforce">;
type TaskForceConfig = Partial<Record<TaskForceCliType, TaskForceSelection>>;

// ─── 상수 ──────────────────────────────────────────────

/** 저장 파일명 */
const SELECTED_MODELS_FILE = "selected-models.json";

const TASKFORCE_CLI_TYPES: readonly CliType[] = ["claude", "codex", "gemini"];

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

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
    return sanitizeSelectedModelsConfig(raw);
  } catch {
    return {};
  }
}

/**
 * selected-models.json을 저장합니다.
 */
export function saveSelectedModels(configDir: string, config: SelectedModelsConfig): void {
  const filePath = path.join(configDir, SELECTED_MODELS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(sanitizeSelectedModelsConfig(config), null, 2), "utf-8");
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

// ─── Task Force 모델 설정 ───────────────────────────────

/**
 * Task Force 백엔드별 모델 설정을 반환합니다.
 *
 * selected-models.json[carrierId].taskforce[cliType] 존재 시에만 반환합니다.
 * 명시적 설정이 없으면 undefined를 반환합니다 (auto 폴백 없음).
 */
export function getTaskForceModelConfig(
  configDir: string,
  carrierId: string,
  cliType: string,
): TaskForceSelection | undefined {
  const resolvedCliType = toTaskForceCliType(cliType);
  const config = loadSelectedModels(configDir);
  const carrierConfig = config[carrierId];

  return sanitizeTaskForceSelection(resolvedCliType, carrierConfig?.taskforce?.[resolvedCliType]) ?? undefined;
}

/**
 * 지정 캐리어가 모든 CLI 백엔드(claude/codex/gemini)에 대해
 * Task Force 설정을 완료했는지 확인합니다.
 */
export function isTaskForceFullyConfigured(configDir: string, carrierId: string): boolean {
  const config = loadSelectedModels(configDir);
  const carrierConfig = config[carrierId];
  if (!carrierConfig?.taskforce) return false;
  return TASKFORCE_CLI_TYPES.every((cli) =>
    sanitizeTaskForceSelection(cli, carrierConfig.taskforce?.[cli]) !== null,
  );
}

/**
 * 등록된 전체 캐리어 중 Task Force 설정이 완전히 구성된 캐리어 ID 목록을 반환합니다.
 */
export function getConfiguredTaskForceCarrierIds(configDir: string, registeredIds: string[]): string[] {
  return registeredIds.filter((id) => isTaskForceFullyConfigured(configDir, id));
}

/**
 * Task Force 백엔드별 모델 설정을 저장합니다.
 */
export function updateTaskForceModelSelection(
  configDir: string,
  carrierId: string,
  cliType: string,
  selection: TaskForceSelection,
): void {
  const resolvedCliType = toTaskForceCliType(cliType);
  const sanitizedSelection = sanitizeTaskForceSelection(resolvedCliType, selection);
  if (!sanitizedSelection) {
    throw new Error(`Invalid Task Force model selection for ${resolvedCliType}.`);
  }

  const existing = loadSelectedModels(configDir);
  ensureTaskForceConfig(existing, carrierId)[resolvedCliType] = sanitizedSelection;
  saveSelectedModels(configDir, existing);
}

/**
 * Task Force 백엔드별 모델 설정을 초기화합니다 (origin으로 되돌림).
 */
export function resetTaskForceModelSelection(
  configDir: string,
  carrierId: string,
  cliType: string,
): void {
  const resolvedCliType = toTaskForceCliType(cliType);
  const existing = loadSelectedModels(configDir);
  const carrierConfig = existing[carrierId];
  if (!carrierConfig?.taskforce) return;

  delete carrierConfig.taskforce[resolvedCliType];
  pruneEmptyTaskForceConfig(carrierConfig);
  saveSelectedModels(configDir, existing);
}

function sanitizeSelectedModelsConfig(raw: unknown): SelectedModelsConfig {
  if (!isRecord(raw)) return {};

  const result: SelectedModelsConfig = {};

  for (const [key, value] of Object.entries(raw)) {
    const sanitizedKey = sanitizeConfigKey(key);
    if (!sanitizedKey) continue;

    if (typeof value === "string") {
      const legacyModel = sanitizeFreeformText(value);
      if (!legacyModel) continue;
      result[sanitizedKey] = { model: legacyModel };
      continue;
    }

    const sanitizedSelection = sanitizeModelSelection(value);
    if (sanitizedSelection) {
      result[sanitizedKey] = sanitizedSelection;
    }
  }

  return result;
}

function sanitizeModelSelection(value: unknown): ModelSelection | null {
  if (!isRecord(value)) return null;

  const taskforce = sanitizeTaskforceConfig(value.taskforce);
  const model = sanitizeFreeformText(value.model);
  if (!model && !taskforce) return null;

  const result: ModelSelection = { model: model ?? "" };

  if (typeof value.direct === "boolean") {
    result.direct = value.direct;
  }

  const effort = sanitizeFreeformText(value.effort);
  if (effort) {
    result.effort = effort;
  }

  const budgetTokens = sanitizeBudgetTokens(value.budgetTokens);
  if (budgetTokens !== undefined) {
    result.budgetTokens = budgetTokens;
  }

  if (taskforce) {
    result.taskforce = taskforce;
  }

  return result;
}

function sanitizeTaskforceConfig(value: unknown): TaskForceConfig | undefined {
  if (!isRecord(value)) return undefined;

  const taskforce: TaskForceConfig = {};
  for (const [cliKey, cliValue] of Object.entries(value)) {
    if (!isTaskForceCliType(cliKey)) continue;
    const sanitizedTaskforceSelection = sanitizeTaskForceSelection(cliKey, cliValue);
    if (sanitizedTaskforceSelection) {
      taskforce[cliKey] = sanitizedTaskforceSelection;
    }
  }

  return Object.keys(taskforce).length > 0 ? taskforce : undefined;
}

function sanitizeTaskForceSelection(cliType: CliType, value: unknown): TaskForceSelection | null {
  if (!isRecord(value)) return null;

  const provider = getAvailableModels(cliType);
  const allowedModels = new Set(provider.models.map((model) => model.modelId));
  const model = sanitizeFreeformText(value.model);
  if (!model || !allowedModels.has(model)) return null;

  const result: TaskForceSelection = { model };
  const effortLevels = getEffortLevels(cliType);
  const effort = sanitizeFreeformText(value.effort);

  if (effortLevels && effort && effortLevels.includes(effort)) {
    result.effort = effort;
    if (cliType === "claude" && effort !== "none") {
      result.budgetTokens = sanitizeBudgetTokens(value.budgetTokens) ?? getDefaultBudgetTokens(effort);
    }
  }

  return result;
}

function ensureTaskForceConfig(
  config: SelectedModelsConfig,
  carrierId: string,
): TaskForceConfig {
  if (!config[carrierId]) {
    config[carrierId] = { model: "" };
  }

  if (!config[carrierId]!.taskforce) {
    config[carrierId]!.taskforce = {};
  }

  return config[carrierId]!.taskforce!;
}

function pruneEmptyTaskForceConfig(carrierConfig: ModelSelection): void {
  if (carrierConfig.taskforce && Object.keys(carrierConfig.taskforce).length === 0) {
    delete carrierConfig.taskforce;
  }
}

function toTaskForceCliType(value: string): TaskForceCliType {
  if (isTaskForceCliType(value)) {
    return value;
  }
  throw new Error(`Unsupported Task Force backend: ${value}`);
}

function isTaskForceCliType(value: string): value is TaskForceCliType {
  return TASKFORCE_CLI_TYPES.includes(value as TaskForceCliType);
}

function sanitizeConfigKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || CONTROL_CHAR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function sanitizeFreeformText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || CONTROL_CHAR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function sanitizeBudgetTokens(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
