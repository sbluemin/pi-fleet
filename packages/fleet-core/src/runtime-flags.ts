let fleetCoreDevMode = false;

export function setFleetCoreDevMode(enabled: boolean): void {
  fleetCoreDevMode = enabled;
}

export function isFleetCoreDevMode(): boolean {
  return fleetCoreDevMode;
}
