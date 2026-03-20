/**
 * unified-agent-core — 모델 설정 관리
 *
 * selected-models.json 로드/저장, 프로바이더 모델 정보 조회,
 * 연결 옵션 구성 로직을 제공합니다.
 * PI API 타입을 사용하지 않습니다.
 */

import { getProviderModels, getReasoningEffortLevels } from "@sbluemin/unified-agent";
import type { CliType, ModelSelection, SelectedModelsConfig, ProviderInfo } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 상수 ──────────────────────────────────────────────

/** 저장 파일명 */
const SELECTED_MODELS_FILE = "selected-models.json";

/** SDK 연결 시 사용할 공통 clientInfo */
const CLIENT_INFO = { name: "pi-unified-agent", version: "1.0.0" } as const;

/** effort 레벨별 기본 budget_tokens (Claude 전용) */
const CLAUDE_THINKING_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

// ─── 모델 설정 로드/저장 ────────────────────────────────

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

// ─── 마이그레이션 유틸 ───────────────────────────────────

/**
 * 레거시 디렉토리의 selected-models.json을 새 디렉토리로 복사합니다.
 * 새 디렉토리에 이미 파일이 존재하면 덮어쓰지 않습니다.
 */
export function migrateSelectedModels(legacyDir: string, newDir: string): void {
  try {
    const legacyFile = path.join(legacyDir, SELECTED_MODELS_FILE);
    const newFile = path.join(newDir, SELECTED_MODELS_FILE);
    if (fs.existsSync(legacyFile) && !fs.existsSync(newFile)) {
      fs.copyFileSync(legacyFile, newFile);
    }
  } catch {
    // 마이그레이션 실패 무시
  }
}

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

// ─── 연결 옵션 구성 ────────────────────────────────────

/**
 * CLI 연결에 필요한 공통 옵션 객체를 구성합니다.
 * agent-tool, direct-mode, all-mode에서 반복되던 3중 중복을 제거합니다.
 */
export function buildConnectOptions(
  cli: CliType,
  cwd: string,
  configDir: string,
): Record<string, unknown> {
  const savedConfig = loadSelectedModels(configDir);
  const cliConfig = savedConfig[cli];

  const opts: Record<string, unknown> = {
    cwd,
    cli,
    autoApprove: true,
    clientInfo: CLIENT_INFO,
  };

  // 저장된 모델이 있으면 적용
  if (cliConfig?.model) {
    opts.model = cliConfig.model;
  }

  return opts;
}
