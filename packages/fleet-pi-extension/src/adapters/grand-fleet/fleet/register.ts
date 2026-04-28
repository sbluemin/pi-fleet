/**
 * fleet/register.ts — Fleet 역할 facade
 *
 * Fleet 이벤트, 커맨드, 도구, 런타임, Status Overlay owner를 role별 모듈에 위임한다.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getLogAPI } from "../../../config-bridge/log/bridge.js";
import { getState } from "../../../lifecycle/grand-fleet-state.js";
import { registerFleetPiCommands } from "../../../commands/fleet-grand-fleet-commands.js";
import { registerFleetPiEvents } from "../../../lifecycle/grand-fleet-fleet-events.js";
import { registerFleetPiTools } from "../../../tools/grand-fleet-fleet-tools.js";
import { getFleetRuntime } from "./runtime.js";
import type { CarrierMap, FleetStatus } from "@sbluemin/fleet-core/grand-fleet";
import { buildFleetPingPayload } from "./status-source.js";
import { registerFleetStatusOverlayKeybind } from "../../../keybinds/grand-fleet-fleet-status-overlay.js";

interface FleetOverlayRuntimeState {
  activeMissionId: string | null;
  activeMissionObjective: string | null;
  carriers: CarrierMap;
  connectionState: "disconnected" | "connecting" | "connected";
  designation: string | null;
  fleetStatus: FleetStatus;
  heartbeatAgeMs: number | null;
  socketPath: string | null;
}

const LOG_SOURCE = "grand-fleet";

export default function registerFleet(pi: ExtensionAPI): void {
  const state = getState();
  const fleetId = state?.fleetId ?? "unset";
  const socketPath = state?.socketPath ?? "unset";

  getLogAPI().info(LOG_SOURCE, `Fleet 모드 초기화: fleetId=${fleetId}, socket=${socketPath}`);
  getFleetRuntime();
  registerFleetStatusOverlayKeybind();
  registerFleetPiCommands(pi);
  registerFleetPiEvents(pi);
  registerFleetPiTools(pi);
}

export function getFleetOverlayRuntimeState(): FleetOverlayRuntimeState {
  const state = getState();
  const runtime = getFleetRuntime();
  const ping = buildFleetPingPayload(state.fleetId ?? "unset");
  return {
    activeMissionId: ping.activeMissionId,
    activeMissionObjective: ping.activeMissionObjective,
    carriers: ping.carriers,
    connectionState: runtime.client?.getState() ?? "disconnected",
    designation: state.designation,
    fleetStatus: ping.fleetStatus,
    heartbeatAgeMs: runtime.lastHeartbeatAt === null ? null : Date.now() - runtime.lastHeartbeatAt,
    socketPath: state.socketPath,
  };
}
