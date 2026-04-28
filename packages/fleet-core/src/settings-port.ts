export interface FleetSettingsPort {
  load<T = unknown>(key: string): T;
  save<T = unknown>(key: string, value: T): void;
}

let settingsPort: FleetSettingsPort | null = null;

export function setFleetSettingsPort(port: FleetSettingsPort | null): void {
  settingsPort = port;
}

export function getFleetSettingsPort(): FleetSettingsPort | null {
  return settingsPort;
}
