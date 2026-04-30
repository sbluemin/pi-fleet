import {
  loadProviderGuardSettings,
  saveProviderGuardSettings,
  type ProviderGuardSettings,
} from "@sbluemin/fleet-core/core-services/provider-guard";

import { getSettingsAPI } from "../settings/bridge.js";

export type { ProviderGuardSettings };

export function loadSettings(): ProviderGuardSettings {
  const api = getSettingsAPI();
  if (!api) return {};
  return loadProviderGuardSettings(api);
}

export function saveSettings(settings: ProviderGuardSettings): void {
  const api = getSettingsAPI();
  if (!api) throw new Error("Fleet-Core Settings API not available");
  saveProviderGuardSettings(api, settings);
}
