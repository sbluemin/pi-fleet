import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerGrandFleet from "../grand-fleet/register.js";
import { bootAdmiral } from "../admiral/runtime.js";
import {
  initializeFleetRuntime,
  resolveFleetDataDir,
  restoreFleetPreRegistrationState,
  shouldBootFleet,
} from "./fleet-boot.js";
import { registerFleetCarriers } from "./fleet-carriers.js";
import { scheduleFleetBootReconciliation } from "./fleet-boot-reconciliation.js";
import registerBoot from "./boot/index.js";
import registerKeybindLifecycle from "./core-keybind-lifecycle.js";
import registerLogLifecycle from "./core-log-lifecycle.js";
import registerHudLifecycle from "../hud/register.js";
import { wireFleetPiEvents } from "./fleet-pi-events.js";
import registerProviderGuardLifecycle from "../config/provider-guard/register.js";
import registerShellLifecycle from "../../tui/shell/register.js";
import registerThinkingTimerLifecycle from "../config/thinking-timer/register.js";

export interface FleetLifecycleRuntime {
  fleetEnabled: boolean;
}

export function registerLifecycle(pi: ExtensionAPI): FleetLifecycleRuntime {
  registerBoot(pi);
  registerKeybindLifecycle(pi);
  registerHudLifecycle(pi);
  registerProviderGuardLifecycle(pi);
  registerShellLifecycle(pi);
  registerThinkingTimerLifecycle(pi);

  if (!shouldBootFleet()) {
    registerGrandFleet(pi);
    return { fleetEnabled: false };
  }

  const dataDir = resolveFleetDataDir();
  initializeFleetRuntime(dataDir);
  restoreFleetPreRegistrationState();
  registerLogLifecycle(pi);

  bootAdmiral(pi);
  registerFleetCarriers(pi);
  scheduleFleetBootReconciliation();
  wireFleetPiEvents(pi);
  registerGrandFleet(pi);

  return { fleetEnabled: true };
}
