/**
 * core-summarize/settings.ts — 설정 파일 관리
 *
 * core-settings API를 통해 ~/.pi/fleet/settings.json의 "core-summarize" 섹션에서 읽고 쓴다.
 */

import { getSettingsAPI } from "../settings/bridge.js";
import type { CoreSettingsAPI } from "../settings/types.js";

export interface AutoSummarizeSettings {
  /** 모델 프로바이더 (미설정 시 세션 모델 사용) */
  provider?: string;
  /** 모델 ID */
  model?: string;
}

const SECTION_KEY = "core-summarize";

/** 설정 로드 (extensions/settings.json → "as") */
export function loadSettings(): AutoSummarizeSettings {
  try {
    return getAPI().load<AutoSummarizeSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

/** 설정 저장 (extensions/settings.json → "as") */
export function saveSettings(settings: AutoSummarizeSettings): void {
  getAPI().save(SECTION_KEY, settings);
}

function getAPI(): CoreSettingsAPI {
  const api = getSettingsAPI();
  if (!api) throw new Error("core-settings API not available");
  return api;
}
