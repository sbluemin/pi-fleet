import {
  type SectionDisplayConfig,
} from "@sbluemin/fleet-core/services/settings";

import { getSettingsAPI } from "./bridge.js";

export function registerSection(config: SectionDisplayConfig): void {
  getSettingsAPI()?.registerSection(config);
}

export function unregisterSection(key: string): void {
  getSettingsAPI()?.unregisterSection(key);
}

export function getSections(): SectionDisplayConfig[] {
  return getSettingsAPI()?.getSections() ?? [];
}
