import type { CoreSettingsAPI } from "../settings/types.js";
import type { ProviderGuardSettings } from "./types.js";
import { PROVIDER_GUARD_SECTION_KEY } from "./types.js";

export function loadProviderGuardSettings(
  settingsApi: Pick<CoreSettingsAPI, "load">,
): ProviderGuardSettings {
  try {
    return settingsApi.load<ProviderGuardSettings>(PROVIDER_GUARD_SECTION_KEY);
  } catch {
    return {};
  }
}

export function saveProviderGuardSettings(
  settingsApi: Pick<CoreSettingsAPI, "save">,
  settings: ProviderGuardSettings,
): void {
  settingsApi.save(PROVIDER_GUARD_SECTION_KEY, settings);
}
