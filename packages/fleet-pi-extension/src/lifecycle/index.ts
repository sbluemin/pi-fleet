import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerGrandFleet from "./grand-fleet-register.js";
import { bootAdmiral } from "./admiral/runtime.js";
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
import registerHudLifecycle from "./hud-register.js";
import { wireFleetPiEvents } from "./fleet-pi-events.js";
import { registerOperationName } from "./metaphor/operation-name-register.js";
import registerProviderGuardLifecycle from "./provider-guard-register.js";
import registerShellLifecycle from "./shell-register.js";
import registerThinkingTimerLifecycle from "./thinking-timer-register.js";

export interface FleetLifecycleRuntime {
  fleetEnabled: boolean;
}

export function registerLifecycle(pi: ExtensionAPI): FleetLifecycleRuntime {
  registerBoot(pi);
  registerKeybindLifecycle(pi);
  registerLogLifecycle(pi);
  registerHudLifecycle(pi);
  registerProviderGuardLifecycle(pi);
  registerShellLifecycle(pi);
  registerThinkingTimerLifecycle(pi);

  if (!shouldBootFleet()) {
    registerGrandFleet(pi);
    registerOperationName(pi);
    return { fleetEnabled: false };
  }

  const dataDir = resolveFleetDataDir();
  initializeFleetRuntime(dataDir);
  restoreFleetPreRegistrationState();

  bootAdmiral(pi);
  registerFleetCarriers(pi);
  scheduleFleetBootReconciliation();
  wireFleetPiEvents(pi);
  registerGrandFleet(pi);
  registerOperationName(pi);

  return { fleetEnabled: true };
}
