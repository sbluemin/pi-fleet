/**
 * utils-summarize/settings.ts — 설정 파일 관리
 *
 * infra-settings API를 통해 extensions/settings.json의 "as" 키에서 읽고 쓴다.
 */

import type { InfraSettingsAPI } from "../../dock/settings/types.js";
import { INFRA_SETTINGS_KEY } from "../../dock/settings/types.js";

const SECTION_KEY = "utils-summarize";

export interface AutoSummarizeSettings {
  /** 모델 프로바이더 (미설정 시 세션 모델 사용) */
  provider?: string;
  /** 모델 ID */
  model?: string;
  /** 요약 최대 길이 (기본: 80) */
  maxLength?: number;
}

function getAPI(): InfraSettingsAPI {
  const api = (globalThis as any)[INFRA_SETTINGS_KEY];
  if (!api) throw new Error("infra-settings API not available");
  return api;
}

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
