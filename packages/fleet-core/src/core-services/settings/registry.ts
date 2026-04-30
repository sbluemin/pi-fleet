import type { SectionDisplayConfig } from "./types.js";

export function registerSectionInMap(
  sections: Map<string, SectionDisplayConfig>,
  config: SectionDisplayConfig,
): void {
  sections.set(config.key, config);
}

export function unregisterSectionFromMap(
  sections: Map<string, SectionDisplayConfig>,
  key: string,
): void {
  sections.delete(key);
}

export function getSectionsFromMap(
  sections: Map<string, SectionDisplayConfig>,
): SectionDisplayConfig[] {
  return [...sections.values()];
}
