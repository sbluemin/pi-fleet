import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerAgent } from "./agent/index.js";
import registerBoot from "./fleet.js";
import registerFleetWiki from "./fleet-wiki/index.js";
import registerGrandFleet from "./grand-fleet/index.js";
import { registerJob } from "./job.js";
import {
  initializeFleetRuntime,
  registerFleetCarriers,
  resolveFleetDataDir,
  restoreFleetPreRegistrationState,
  scheduleFleetBootReconciliation,
  shouldBootFleet,
  wireFleetPiEvents,
} from "./fleet.js";
import { mountTuiSurfaces } from "./shell/tui-surfaces.js";
import { registerCommands } from "./shell/commands/index.js";
import { registerLog as registerLogDomain } from "./log.js";
import { registerMetaphor } from "./metaphor.js";
import { registerSettings } from "./settings.js";
import { registerShell } from "./shell/index.js";
import { registerToolRegistry } from "./tool-registry.js";

export function bootFleet(ctx: ExtensionAPI): void {
  registerBoot(ctx);
  const fleetEnabled = shouldBootFleet();

  if (fleetEnabled) {
    initializeFleetRuntime(resolveFleetDataDir());
  }

  registerShell(ctx);
  registerAgent(ctx);
  registerFleet(ctx, fleetEnabled);
  registerGrandFleet(ctx);
  registerFleetWiki(ctx as any);
  registerMetaphorDomain(ctx, fleetEnabled);
  if (fleetEnabled) registerJob(ctx);
  registerSettings(ctx);
  registerLog(ctx, fleetEnabled);
  registerToolRegistry(ctx, fleetEnabled);
}

function registerFleet(pi: ExtensionAPI, fleetEnabled: boolean): void {
  if (!fleetEnabled) return;

  restoreFleetPreRegistrationState();
  registerFleetCarriers(pi);
  scheduleFleetBootReconciliation();
  wireFleetPiEvents(pi);
  mountTuiSurfaces(pi, fleetEnabled);
  registerCommands(pi, fleetEnabled);
}

function registerMetaphorDomain(pi: ExtensionAPI, fleetEnabled: boolean): void {
  if (!fleetEnabled) return;
  registerMetaphor(pi);
}

function registerLog(pi: ExtensionAPI, fleetEnabled: boolean): void {
  if (!fleetEnabled) return;
  registerLogDomain(pi);
}
