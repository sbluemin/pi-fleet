import {
  CORE_SETTINGS_KEY,
  type SectionDisplayConfig,
} from "@sbluemin/fleet-core/services/settings";

import { getFleetRuntime } from "../../runtime/fleet-boot.js";

export { CORE_SETTINGS_KEY };

interface SettingsAPI {
  load<T = Record<string, unknown>>(sectionKey: string): T;
  save(sectionKey: string, data: unknown): void;
  registerSection(config: SectionDisplayConfig): void;
  unregisterSection(sectionKey: string): void;
  getSections(): SectionDisplayConfig[];
}

export function getSettingsAPI(): SettingsAPI | undefined {
  try {
    return getFleetRuntime().settings.settings;
  } catch {
    return undefined;
  }
}
