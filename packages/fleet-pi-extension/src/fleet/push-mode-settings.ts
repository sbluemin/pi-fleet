/**
 * push-mode-settings.ts — carrier result push 전달 방식 설정
 *
 * core-settings API를 통해 ~/.pi/fleet/settings.json의 "fleet-push-mode" 섹션에서 읽고 쓴다.
 */

import { getSettingsAPI } from "../core/settings/bridge.js";
import type { CoreSettingsAPI } from "../core/settings/types.js";

export interface FleetPushModeSettings {
  deliverAs?: "followUp" | "steer";
}

export const SECTION_KEY = "fleet-push-mode";

/** 설정 로드 */
export function loadSettings(): FleetPushModeSettings {
  try {
    return getAPI().load<FleetPushModeSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

/** 설정 저장 */
export function saveSettings(settings: FleetPushModeSettings): void {
  getAPI().save(SECTION_KEY, settings);
}

/** 현재 push 전달 방식을 반환합니다. */
export function getDeliverAs(): "followUp" | "steer" {
  const deliverAs = loadSettings().deliverAs;
  return deliverAs === "steer" ? "steer" : "followUp";
}

/** push 전달 방식을 저장합니다. */
export async function setDeliverAs(value: "followUp" | "steer"): Promise<void> {
  saveSettings({ deliverAs: value });
}

/** SettingsOverlay 노출용 섹션을 등록합니다. */
export function registerPushModeSettingsSection(): void {
  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: SECTION_KEY,
    displayName: "Push Mode",
    getDisplayFields() {
      const deliverAs = getDeliverAs();
      return [
        {
          label: "Deliver As",
          value: deliverAs === "followUp" ? "Follow-up" : "Steer",
          color: deliverAs === "followUp" ? "accent" : "warning",
        },
      ];
    },
  });
}

function getAPI(): CoreSettingsAPI {
  const api = getSettingsAPI();
  if (!api) throw new Error("core-settings API not available");
  return api;
}
