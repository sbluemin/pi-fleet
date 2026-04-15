/**
 * core-improve-prompt/settings.ts — 설정 파일 관리 (ACP 전용)
 *
 * core-settings API를 통해 ~/.pi/fleet/settings.json의 "core-improve-prompt" 섹션에서 읽고 쓴다.
 */

import type { ReasoningLevel } from "./constants.js";
import { getSettingsAPI } from "../settings/bridge.js";
import type { CoreSettingsAPI } from "../settings/types.js";

/** 설정 파일 구조 (ACP 전용) */
export interface MetaPromptSettings {
  /** ACP 모델 ID (e.g. "acp:claude:opus") — 미설정 시 세션 모델 폴백 */
  model?: string;
  /** Reasoning 레벨 (off / low / medium / high) */
  reasoning?: ReasoningLevel;
}

const SECTION_KEY = "core-improve-prompt";

/** 설정 로드 */
export function loadSettings(): MetaPromptSettings {
  try {
    return getAPI().load<MetaPromptSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

/** 설정 저장 */
export function saveSettings(settings: MetaPromptSettings): void {
  getAPI().save(SECTION_KEY, settings);
}

function getAPI(): CoreSettingsAPI {
  const api = getSettingsAPI();
  if (!api) throw new Error("core-settings API not available");
  return api;
}
