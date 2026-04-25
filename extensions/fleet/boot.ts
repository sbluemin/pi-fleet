import type { CliType } from "@sbluemin/unified-agent";
import * as os from "node:os";
import * as path from "node:path";

import {
  initRuntime,
} from "../core/agentclientprotocol/runtime.js";
import { initServiceStatus } from "../core/agentclientprotocol/service-status/store.js";
import { exposeAgentApi } from "./operation-runner.js";
import { setAgentPanelServiceLoading, setAgentPanelServiceStatus } from "./bridge/panel/config.js";
import {
  setPendingCliTypeOverrides,
  setSortieDisabledCarriers,
  setSquadronEnabledCarriers,
} from "./shipyard/carrier/framework.js";
import {
  initStore,
  loadCliTypeOverrides,
  loadSortieDisabled,
  loadSquadronEnabled,
} from "./shipyard/store.js";

export function shouldBootFleet(): boolean {
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  return bootCfg?.fleet !== false;
}

export function resolveFleetDataDir(): string {
  // os.homedir() 직접 사용으로 PI_CODING_AGENT_DIR override와 무관하게 경로를 고정한다.
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
  // 부팅 시에는 carrier 등록 전이므로 validIds 필터 없이 전체 로드.
  const restoredDisabled = loadSortieDisabled();
  if (restoredDisabled.length > 0) {
    setSortieDisabledCarriers(restoredDisabled);
  }

  const restoredSquadron = loadSquadronEnabled();
  if (restoredSquadron.length > 0) {
    setSquadronEnabledCarriers(restoredSquadron);
  }

  // registerCarrier() 호출 시 자동 적용되도록 pending 상태로 저장한다.
  const restoredCliTypeOverrides = loadCliTypeOverrides();
  if (Object.keys(restoredCliTypeOverrides).length > 0) {
    setPendingCliTypeOverrides(restoredCliTypeOverrides as Record<string, CliType>);
  }
}
