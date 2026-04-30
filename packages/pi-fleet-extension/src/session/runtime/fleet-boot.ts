import type { CliType } from "@sbluemin/fleet-core/agent/provider-client";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";

import { createFleetCoreRuntime, type FleetCoreRuntimeContext } from "@sbluemin/fleet-core";
import {
  loadCliTypeOverrides,
  loadSortieDisabled,
  loadSquadronEnabled,
} from "@sbluemin/fleet-core/admiral/store";

import { exposeAgentApi } from "../fleet/operation-runner.js";
import { createPanelStreamingSink } from "../../tui/agent-panel/streaming-sink.js";
import {
  setPendingCliTypeOverrides,
  setSortieDisabledCarriers,
  setSquadronEnabledCarriers,
} from "../../tools/carrier/framework.js";
import { createFleetBootHostPorts } from "./boot-ports.js";

let fleetRuntime: FleetCoreRuntimeContext | undefined;
let currentAgentRequestCtx: ExtensionContext | undefined;

export function shouldBootFleet(): boolean {
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  return bootCfg?.fleet !== false;
}

export function resolveFleetDataDir(): string {
  return path.join(os.homedir(), ".pi", "fleet");
}

export function initializeFleetRuntime(dataDir: string, ctx?: ExtensionContext): void {
  fleetRuntime = createFleetCoreRuntime({
    dataDir,
    ports: createFleetBootHostPorts(createPanelStreamingSink(() => currentAgentRequestCtx ?? ctx)),
  });
  exposeAgentApi();
}

export async function withAgentRequestContext<T>(
  ctx: ExtensionContext,
  run: () => Promise<T>,
): Promise<T> {
  const previous = currentAgentRequestCtx;
  currentAgentRequestCtx = ctx;
  try {
    return await run();
  } finally {
    currentAgentRequestCtx = previous;
  }
}

export function getFleetRuntime(): FleetCoreRuntimeContext {
  if (!fleetRuntime) {
    throw new Error("Fleet core runtime has not been initialized.");
  }
  return fleetRuntime;
}

export async function shutdownFleetRuntime(): Promise<void> {
  const runtime = fleetRuntime;
  fleetRuntime = undefined;
  await runtime?.shutdown();
}

export function restoreFleetPreRegistrationState(): void {
  const restoredDisabled = loadSortieDisabled();
  if (restoredDisabled.length > 0) {
    setSortieDisabledCarriers(restoredDisabled);
  }

  const restoredSquadron = loadSquadronEnabled();
  if (restoredSquadron.length > 0) {
    setSquadronEnabledCarriers(restoredSquadron);
  }

  const restoredCliTypeOverrides = loadCliTypeOverrides();
  if (Object.keys(restoredCliTypeOverrides).length > 0) {
    setPendingCliTypeOverrides(restoredCliTypeOverrides as Record<string, CliType>);
  }
}
