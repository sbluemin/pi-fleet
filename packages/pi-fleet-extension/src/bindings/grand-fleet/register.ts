import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { GrandFleetRole } from "@sbluemin/fleet-core/gfleet";

import { getLogAPI } from "../config/log/bridge.js";
import registerAdmiralty from "./admiralty/register.js";
import registerFleet from "./fleet/register.js";
import { initGrandFleetState } from "./state.js";

export default function registerGrandFleet(pi: ExtensionAPI): void {
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  if (bootCfg && !bootCfg.grandFleet) return;

  const log = getLogAPI();
  const role = detectRole();
  if (!role) {
    log.debug("grand-fleet", "PI_GRAND_FLEET_ROLE 미설정 — 단일 함대 모드");
    return;
  }

  log.info("grand-fleet", `역할 감지: ${role}`);
  initGrandFleetState(role);

  if (role === "admiralty") {
    log.info("grand-fleet", "Admiralty 모드 초기화");
    registerAdmiralty(pi);
    return;
  }

  log.info("grand-fleet", `Fleet 모드 초기화 — fleetId=${process.env.PI_FLEET_ID}`);
  registerFleet(pi);
}

function detectRole(): GrandFleetRole | null {
  const roleEnv = process.env.PI_GRAND_FLEET_ROLE;
  if (roleEnv === "admiralty" || roleEnv === "fleet") return roleEnv;
  return null;
}
