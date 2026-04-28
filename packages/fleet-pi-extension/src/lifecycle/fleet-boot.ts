import type { CliType } from "@sbluemin/unified-agent";
import * as os from "node:os";
import * as path from "node:path";

import { initRuntime } from "@sbluemin/fleet-core/agent/runtime";
import { initServiceStatus } from "@sbluemin/fleet-core/agent/service-status";
import {
  initStore,
  loadCliTypeOverrides,
  loadSortieDisabled,
  loadSquadronEnabled,
} from "@sbluemin/fleet-core/store";

import { setAgentPanelServiceLoading, setAgentPanelServiceStatus } from "../tui/panel/config.js";
import { exposeAgentApi } from "../session-bridge/fleet/operation-runner.js";
import {
  setPendingCliTypeOverrides,
  setSortieDisabledCarriers,
  setSquadronEnabledCarriers,
} from "../tools/carrier/framework.js";

export function shouldBootFleet(): boolean {
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  return bootCfg?.fleet !== false;
}

export function resolveFleetDataDir(): string {
  return path.join(os.homedir(), ".pi", "fleet");
}

export function initializeFleetRuntime(dataDir: string): void {
  initRuntime(dataDir);
  initStore(dataDir);
  initServiceStatus({
    setLoading: setAgentPanelServiceLoading,
    setStatus: setAgentPanelServiceStatus,
  });
  exposeAgentApi();
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
