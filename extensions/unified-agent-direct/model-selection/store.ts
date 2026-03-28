/**
 * model-selection/store.ts — 모델 설정 영속화
 *
 * selected-models.json 로드/저장을 담당합니다.
 */

import type { ModelSelection, SelectedModelsConfig } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 상수 ──────────────────────────────────────────────

/** 저장 파일명 */
const SELECTED_MODELS_FILE = "selected-models.json";

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
