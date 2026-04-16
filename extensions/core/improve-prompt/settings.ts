/**
 * core-improve-prompt/settings.ts — 설정 파일 관리
 *
 * core-settings API를 통해 ~/.pi/fleet/settings.json의 "core-improve-prompt" 섹션에서 읽고 쓴다.
 */

import type { ReasoningLevel } from "./constants.js";
import { getSettingsAPI } from "../settings/bridge.js";
import type { CoreSettingsAPI } from "../settings/types.js";

/** 설정 파일 구조 */
export interface MetaPromptSettings {
  /** 모델 프로바이더 (e.g. "anthropic", "github-copilot") */
  provider?: string;
  /** 모델 ID (e.g. "claude-sonnet-4.6") */
  model?: string;
  /** Reasoning 레벨 (off / low / medium / high) */
  reasoning?: ReasoningLevel;
}

const SECTION_KEY = "core-improve-prompt";

/** 설정 로드 (settings.json → "core-improve-prompt") */
export function loadSettings(): MetaPromptSettings {
  try {
    return getAPI().load<MetaPromptSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

/** 설정 저장 (settings.json → "core-improve-prompt") */
export function saveSettings(settings: MetaPromptSettings): void {
  getAPI().save(SECTION_KEY, settings);
}

function getAPI(): CoreSettingsAPI {
  const api = getSettingsAPI();
  if (!api) throw new Error("core-settings API not available");
  return api;
}
