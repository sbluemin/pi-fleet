import {
  CORE_SETTINGS_KEY,
  type SectionDisplayConfig,
} from "@sbluemin/fleet-core/core-services/settings";

import { getFleetRuntime } from "../../runtime/fleet-boot.js";

export { CORE_SETTINGS_KEY };

interface SettingsAPI {
  load<T = Record<string, unknown>>(sectionKey: string): T;
  save(sectionKey: string, data: unknown): void;
  registerSection(config: SectionDisplayConfig): void;
  unregisterSection(sectionKey: string): void;
  getSections(): SectionDisplayConfig[];
}

interface RuntimeWithSettings {
  readonly coreServices: {
    readonly settings: SettingsAPI;
  };
}

export function getSettingsAPI(): SettingsAPI | undefined {
  try {
    return (getFleetRuntime() as unknown as RuntimeWithSettings).coreServices.settings;
  } catch {
    return undefined;
  }
}
