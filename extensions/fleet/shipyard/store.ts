/**
 * fleet/shipyard/store.ts — Fleet 통합 영속 스토어
 *
 * 모든 fleet 영속 상태를 `states.json` 단일 파일로 일원화합니다.
 * - 모델 선택 (기존 model-config.ts)
 * - Sortie 비활성 상태 (기존 sortie-store.ts)
 * - cliType 오버라이드 (기존 sortie-store.ts)
 *
 * 단일 게이트 I/O 패턴으로 race condition을 방지합니다.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getProviderModels, getReasoningEffortLevels } from "@sbluemin/unified-agent";
import type { CliType } from "@sbluemin/unified-agent";
import { disconnectClient } from "../../core/agent/client-pool.js";
import { getSessionStore } from "../../core/agent/runtime.js";

// ─── 타입 정의 ──────────────────────────────────────────

/** 각 carrier별 모델 선택 설정 */
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

/** states.json의 models 키 전체 구조 */
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

/** states.json 통합 스키마 */
interface FleetStates {
  /** 모델 선택 설정 */
  models?: SelectedModelsConfig;
  /** sortie 비활성 carrier ID 목록 */
  sortieDisabled?: string[];
  /** carrier별 cliType 오버라이드 (defaultCliType과 다를 때만 저장) */
  cliTypeOverrides?: Record<string, string>;
}

// ─── 상수 ──────────────────────────────────────────────

/** 통합 영속화 파일명 */
const FILENAME = "states.json";

const TASKFORCE_CLI_TYPES: readonly CliType[] = ["claude", "codex", "gemini"];

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

/** effort 레벨별 기본 budget_tokens (Claude 전용) */
const CLAUDE_THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

/** 유효한 cliType 값 집합 */
const VALID_CLI_TYPES = new Set(["claude", "codex", "gemini"]);

// ─── 내부 상태 ─────────────────────────────────────────

/** 스토어 데이터 디렉토리 */
let storeDir: string | null = null;

// ─── 초기화 ─────────────────────────────────────────────

/**
 * Fleet 통합 스토어를 초기화합니다.
 * index.ts에서 initRuntime() 직후 1회 호출합니다.
 */
export function initStore(dir: string): void {
  storeDir = dir;

}

// ─── 단일 게이트 I/O ────────────────────────────────────

function readStates(): FleetStates {
  if (!storeDir) return {};
  const filePath = path.join(storeDir, FILENAME);
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as FleetStates;
  } catch {
    return {};
  }
}

function writeStates(s: FleetStates): void {
  if (!storeDir) return;
  const filePath = path.join(storeDir, FILENAME);
  const tmpPath = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(s, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch {
    // 영속화 실패 무시 — 다음 저장 시점에 다시 시도
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// ─── 모델 설정 영속화 ──────────────────────────────────

/** 현재 모델 설정을 로드합니다. */
export function loadModels(): SelectedModelsConfig {
  const states = readStates();
  return sanitizeSelectedModelsConfig(states.models) ?? {};
}

/** 모델 설정을 저장합니다. */
export function saveModels(config: SelectedModelsConfig): void {
  const states = readStates();
  states.models = sanitizeSelectedModelsConfig(config);
  writeStates(states);
}

/**
 * Carrier의 모델 설정을 변경하고 세션을 무효화합니다.
 * 원자적 연산: save → session clear → disconnect
 * clear 먼저: executor가 stale sessionId로 resume 시도하는 창 제거
 */
export async function updateModelSelection(
  carrierId: string,
  selection: ModelSelection,
): Promise<void> {
  const s = readStates();
  s.models = { ...s.models, [carrierId]: selection };
  writeStates(s);
  getSessionStore().clear(carrierId);
  await disconnectClient(carrierId);
}

/**
 * 전체 모델 설정을 교체하고 변경된 키의 세션을 무효화합니다.
 * 원자적 연산: save → session clear all → disconnect all
 */
export async function updateAllModelSelections(
  config: SelectedModelsConfig,
): Promise<void> {
  saveModels(config);
  const keys = Object.keys(config);
  const sessionStore = getSessionStore();
  for (const key of keys) {
    sessionStore.clear(key);
  }
  await Promise.allSettled(keys.map((key) => disconnectClient(key)));
}

// ─── Task Force 모델 설정 ───────────────────────────────

/**
 * Task Force 백엔드별 모델 설정을 반환합니다.
 * 명시적 설정이 없으면 undefined를 반환합니다 (auto 폴백 없음).
 */
export function getTaskForceModelConfig(
  carrierId: string,
  cliType: string,
): TaskForceSelection | undefined {
  const resolvedCliType = toTaskForceCliType(cliType);
  const config = loadModels();
  const taskforceConfig = getSanitizedTaskForceConfig(config, carrierId);
  return taskforceConfig?.[resolvedCliType];
}

/**
 * Task Force 백엔드별 모델 설정을 저장합니다.
 */
export function updateTaskForceModelSelection(
  carrierId: string,
  cliType: string,
  selection: TaskForceSelection,
): void {
  const resolvedCliType = toTaskForceCliType(cliType);
  const sanitizedSelection = sanitizeTaskForceSelection(resolvedCliType, selection);
  if (!sanitizedSelection) {
    throw new Error(`Invalid Task Force model selection for ${resolvedCliType}.`);
  }

  const existing = loadModels();
  ensureTaskForceConfig(existing, carrierId)[resolvedCliType] = sanitizedSelection;
  saveModels(existing);
}

/**
 * Task Force 백엔드별 모델 설정을 초기화합니다 (origin으로 되돌림).
 */
export function resetTaskForceModelSelection(
  carrierId: string,
  cliType: string,
): void {
  const resolvedCliType = toTaskForceCliType(cliType);
  const existing = loadModels();
  const carrierConfig = existing[carrierId];
  if (!carrierConfig?.taskforce) return;

  delete carrierConfig.taskforce[resolvedCliType];
  pruneEmptyTaskForceConfig(carrierConfig);
  saveModels(existing);
}

/**
 * 지정 캐리어가 모든 CLI 백엔드(claude/codex/gemini)에 대해
 * Task Force 설정을 완료했는지 확인합니다.
 */
export function isTaskForceFullyConfigured(carrierId: string): boolean {
  return isTaskForceFullyConfiguredInConfig(loadModels(), carrierId);
}

/**
 * 등록된 전체 캐리어 중 Task Force 설정이 완전히 구성된 캐리어 ID 목록을 반환합니다.
 */
export function getConfiguredTaskForceCarrierIds(registeredIds: string[]): string[] {
  const config = loadModels();
  return registeredIds.filter((id) => isTaskForceFullyConfiguredInConfig(config, id));
}

// ─── Sortie 상태 ───────────────────────────────────────

/**
 * 디스크에서 sortie 비활성 carrier ID 목록을 로드합니다.
 * 유효한 carrier ID만 필터링하여 반환합니다.
 */
export function loadSortieDisabled(validIds?: Set<string>): string[] {
  const states = readStates();
  const ids = states.sortieDisabled;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string =>
    typeof id === "string" && (!validIds || validIds.has(id)),
  );
}

/**
 * sortie 비활성 carrier ID 목록을 디스크에 저장합니다.
 */
export function saveSortieDisabled(ids: string[]): void {
  const states = readStates();
  states.sortieDisabled = ids;
  writeStates(states);
}

// ─── cliType 오버라이드 ─────────────────────────────────

/**
 * 디스크에서 cliType 오버라이드 맵을 로드합니다.
 * 유효한 carrier ID와 cliType 값만 필터링하여 반환합니다.
 */
export function loadCliTypeOverrides(validIds?: Set<string>): Record<string, string> {
  const states = readStates();
  const overrides = states.cliTypeOverrides;
  if (!overrides || typeof overrides !== "object") return {};
  const result: Record<string, string> = {};
  for (const [id, value] of Object.entries(overrides)) {
    if (typeof value !== "string") continue;
    if (!VALID_CLI_TYPES.has(value)) continue;
    if (validIds && !validIds.has(id)) continue;
    result[id] = value;
  }
  return result;
}

/**
 * cliType 오버라이드 맵을 디스크에 저장합니다.
 */
export function saveCliTypeOverrides(overrides: Record<string, string>): void {
  const states = readStates();
  states.cliTypeOverrides = overrides;
  writeStates(states);
}

// ─── 프로바이더 카탈로그 (순수 함수) ────────────────────

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

// ─── 내부 sanitize 헬퍼 ─────────────────────────────────

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

function getSanitizedTaskForceConfig(
  config: SelectedModelsConfig,
  carrierId: string,
): TaskForceConfig | undefined {
  return sanitizeTaskforceConfig(config[carrierId]?.taskforce);
}

function isTaskForceFullyConfiguredInConfig(
  config: SelectedModelsConfig,
  carrierId: string,
): boolean {
  const taskforceConfig = getSanitizedTaskForceConfig(config, carrierId);
  if (!taskforceConfig) return false;
  return TASKFORCE_CLI_TYPES.every((cli) => taskforceConfig[cli as TaskForceCliType] != null);
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
  return TASKFORCE_CLI_TYPES.includes(value as CliType);
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
