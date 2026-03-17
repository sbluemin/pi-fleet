/**
 * utils-summarize/settings.ts — 설정 파일 관리
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = "settings.json";

export interface AutoSummarizeSettings {
  /** 모델 프로바이더 (미설정 시 세션 모델 사용) */
  provider?: string;
  /** 모델 ID */
  model?: string;
  /** 요약 최대 길이 (기본: 80) */
  maxLength?: number;
}

function getSettingsPath(): string {
  return path.join(EXT_DIR, SETTINGS_FILE);
}

export function loadSettings(): AutoSummarizeSettings {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null) return {};
    return raw as AutoSummarizeSettings;
  } catch {
    return {};
  }
}

export function saveSettings(settings: AutoSummarizeSettings): void {
  fs.writeFileSync(
    getSettingsPath(),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
}
