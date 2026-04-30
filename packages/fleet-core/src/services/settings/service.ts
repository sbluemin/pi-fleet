import {
  getSectionsFromMap,
  registerSectionInMap,
  unregisterSectionFromMap,
} from "./registry.js";
import { loadSection, saveSection } from "./store.js";
import type { CoreSettingsAPI, SectionDisplayConfig } from "./types.js";

export class SettingsService implements CoreSettingsAPI {
  private readonly sections = new Map<string, SectionDisplayConfig>();

  load<T = Record<string, unknown>>(sectionKey: string): T {
    return loadSection<T>(sectionKey);
  }

  save(sectionKey: string, data: unknown): void {
    saveSection(sectionKey, data);
  }

  registerSection(config: SectionDisplayConfig): void {
    registerSectionInMap(this.sections, config);
  }

  unregisterSection(sectionKey: string): void {
    unregisterSectionFromMap(this.sections, sectionKey);
  }

  getSections(): SectionDisplayConfig[] {
    return getSectionsFromMap(this.sections);
  }
}
