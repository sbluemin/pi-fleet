/**
 * utils-improve-prompt/settings.ts — 설정 파일 관리
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ReasoningLevel } from "./constants.js";

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = "settings.json";

/** 설정 파일 구조 */
export interface MetaPromptSettings {
  /** 모델 프로바이더 (e.g. "anthropic", "github-copilot") */
  provider?: string;
  /** 모델 ID (e.g. "claude-sonnet-4.6") */
  model?: string;
  /** Reasoning 레벨 (off / low / medium / high) */
  reasoning?: ReasoningLevel;
}

function getSettingsPath(): string {
  return path.join(EXT_DIR, SETTINGS_FILE);
}

/** 설정 파일 로드 */
export function loadSettings(): MetaPromptSettings {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null) return {};
    return raw as MetaPromptSettings;
  } catch {
    return {};
  }
}

/** 설정 파일 저장 */
export function saveSettings(settings: MetaPromptSettings): void {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}
