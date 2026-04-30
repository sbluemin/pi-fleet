import type { CoreSettingsAPI } from "@sbluemin/fleet-core/services/settings";

import { getSettingsAPI } from "./settings/bridge.js";

export interface FleetPushModeSettings {
  deliverAs?: "followUp" | "steer";
}

export const SECTION_KEY = "fleet-push-mode";

export function loadSettings(): FleetPushModeSettings {
  try {
    return getAPI().load<FleetPushModeSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

export function saveSettings(settings: FleetPushModeSettings): void {
  getAPI().save(SECTION_KEY, settings);
}

export function getDeliverAs(): "followUp" | "steer" {
  const deliverAs = loadSettings().deliverAs;
  return deliverAs === "steer" ? "steer" : "followUp";
}

export async function setDeliverAs(value: "followUp" | "steer"): Promise<void> {
  saveSettings({ deliverAs: value });
}

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
  if (!api) throw new Error("Fleet-Core Settings API not available");
  return api;
}
