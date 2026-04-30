/**
 * operation-name/settings.ts — 설정 파일 관리
 *
 * core-settings API를 통해 ~/.pi/fleet/settings.json의 "metaphor-operation-name" 섹션에서 읽고 쓴다.
 */

import type { ReasoningLevel } from "./constants.js";
import { getFleetSettingsPort, type FleetSettingsPort } from "../../settings-port.js";

export interface OperationNameSettings {
  /** 모델 프로바이더 (미설정 시 세션 모델 사용) */
  provider?: string;
  /** 모델 ID */
  model?: string;
  /** Reasoning 레벨 (off / low / medium / high) */
  reasoning?: ReasoningLevel;
}

export const SECTION_KEY = "metaphor-operation-name";

/** 설정 로드 */
export function loadSettings(): OperationNameSettings {
  try {
    return getAPI().load<OperationNameSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

/** 설정 저장 */
export function saveSettings(settings: OperationNameSettings): void {
  getAPI().save(SECTION_KEY, settings);
}

function getAPI(): FleetSettingsPort {
  const api = getFleetSettingsPort();
  if (!api) throw new Error("core-settings API not available");
  return api;
}
