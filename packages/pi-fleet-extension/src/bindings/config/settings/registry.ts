import {
  getSectionsFromMap,
  registerSectionInMap,
  unregisterSectionFromMap,
  type SectionDisplayConfig,
} from "@sbluemin/fleet-core/core-services/settings";

import { _getSectionsMap } from "./bridge.js";

export function registerSection(config: SectionDisplayConfig): void {
  registerSectionInMap(_getSectionsMap(), config);
}

export function unregisterSection(key: string): void {
  unregisterSectionFromMap(_getSectionsMap(), key);
}

export function getSections(): SectionDisplayConfig[] {
  return getSectionsFromMap(_getSectionsMap());
}
