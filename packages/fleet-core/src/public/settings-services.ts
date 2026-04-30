import type { CoreSettingsAPI } from "../services/settings/index.js";

export interface FleetSettingsServices {
  readonly settings: CoreSettingsAPI;
}

export function createSettingsServices(settings: CoreSettingsAPI): FleetSettingsServices {
  return { settings };
}
