/**
 * admiralty/register.ts — Admiralty 역할 facade
 *
 * 이벤트, 도구, 런타임, Status Bar/Overlay owner를 role별 모듈에 위임한다.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getState } from "../../../lifecycle/grand-fleet-state.js";
import { FleetRegistry } from "./fleet-registry.js";
import { registerAdmiraltyPiEvents } from "../../../lifecycle/grand-fleet-admiralty-events.js";
import { registerAdmiraltyTools } from "../../../tools/grand-fleet-admiralty-tools.js";
import {
  ensureAdmiraltyRuntime,
  readAdmiraltyRuntime,
  setAdmiraltyPresenter,
} from "./runtime.js";
import { registerAdmiraltyStatusOverlayKeybind } from "../../../keybinds/grand-fleet-admiralty-status-overlay.js";

export default function registerAdmiralty(pi: ExtensionAPI): void {
  const runtime = ensureAdmiraltyRuntime();
  getState().socketPath = runtime.socketPath;
  setAdmiraltyPresenter(pi);
  registerAdmiraltyStatusOverlayKeybind();
  registerAdmiraltyPiEvents(pi);
  registerAdmiraltyTools(pi);
}

export function getFleetRegistry(): FleetRegistry | null {
  return readAdmiraltyRuntime()?.registry as FleetRegistry | null;
}
