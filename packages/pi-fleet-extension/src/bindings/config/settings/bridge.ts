export { CORE_SETTINGS_KEY } from "@sbluemin/fleet-core/core-services/settings";
import { CORE_SETTINGS_KEY } from "@sbluemin/fleet-core/core-services/settings";
import type {
  CoreSettingsAPI,
  SectionDisplayConfig,
} from "@sbluemin/fleet-core/core-services/settings";

const _SECTIONS_KEY = "__core_settings_sections__";

if (!(globalThis as any)[_SECTIONS_KEY]) {
  (globalThis as any)[_SECTIONS_KEY] = new Map<string, SectionDisplayConfig>();
}

export function getSettingsAPI(): CoreSettingsAPI | undefined {
  return (globalThis as any)[CORE_SETTINGS_KEY];
}

export function _getSectionsMap(): Map<string, SectionDisplayConfig> {
  return (globalThis as any)[_SECTIONS_KEY];
}
