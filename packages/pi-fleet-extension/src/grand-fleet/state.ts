import {
  GRAND_FLEET_STATE_KEY,
  type GrandFleetRole,
  type GrandFleetState,
} from "@sbluemin/fleet-core/admiralty";

export function getState(): GrandFleetState {
  return (globalThis as any)[GRAND_FLEET_STATE_KEY] as GrandFleetState;
}

export function initGrandFleetState(role: GrandFleetRole): void {
  if ((globalThis as any)[GRAND_FLEET_STATE_KEY]) return;
  (globalThis as any)[GRAND_FLEET_STATE_KEY] = {
    role,
    fleetId: role === "fleet" ? (process.env.PI_FLEET_ID ?? null) : null,
    designation: role === "fleet" ? (process.env.PI_FLEET_DESIGNATION ?? null) : null,
    socketPath: process.env.PI_GRAND_FLEET_SOCK ?? null,
    connectedFleets: new Map(),
    totalCost: 0,
    activeMissionId: null,
    activeMissionObjective: null,
  } satisfies GrandFleetState;
}
