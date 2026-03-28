/**
 * utils-improve-prompt/settings.ts — 설정 파일 관리
 *
 * infra-settings API를 통해 extensions/settings.json의 "mp" 키에서 읽고 쓴다.
 */

import type { ReasoningLevel } from "./constants.js";
import type { InfraSettingsAPI } from "../../extensions-infra/settings/types.js";
import { INFRA_SETTINGS_KEY } from "../../extensions-infra/settings/types.js";

const SECTION_KEY = "utils-improve-prompt";

/** 설정 파일 구조 */
export interface MetaPromptSettings {
  /** 모델 프로바이더 (e.g. "anthropic", "github-copilot") */
  provider?: string;
  /** 모델 ID (e.g. "claude-sonnet-4.6") */
  model?: string;
  /** Reasoning 레벨 (off / low / medium / high) */
  reasoning?: ReasoningLevel;
}

function getAPI(): InfraSettingsAPI {
  const api = (globalThis as any)[INFRA_SETTINGS_KEY];
  if (!api) throw new Error("infra-settings API not available");
  return api;
}

/** 설정 로드 (extensions/settings.json → "mp") */
export function loadSettings(): MetaPromptSettings {
  try {
    return getAPI().load<MetaPromptSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

/** 설정 저장 (extensions/settings.json → "mp") */
export function saveSettings(settings: MetaPromptSettings): void {
  getAPI().save(SECTION_KEY, settings);
}
