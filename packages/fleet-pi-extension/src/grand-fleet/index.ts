/**
 * grand-fleet — 복수 PI 인스턴스 수평 확장 extension 진입점
 *
 * 환경변수 PI_GRAND_FLEET_ROLE에 따라:
 * - admiralty: 지휘소 모드 (Admiralty 페르소나, JSON-RPC 서버, 함대 관리, 프롬프트 전체 교체)
 * - fleet: 함대 모드 (Admiral (제독) 페르소나, JSON-RPC 클라이언트, Grand Fleet Context append)
 * - 미설정: 아무 동작 없음 (기존 단일 함대 모드)
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { GRAND_FLEET_STATE_KEY, type GrandFleetState, type GrandFleetRole } from "./types.js";
import { getLogAPI } from "../core/log/bridge.js";
import registerAdmiralty from "./admiralty/register.js";
import registerFleet from "./fleet/register.js";

export default function registerGrandFleet(pi: ExtensionAPI) {
  // 부트스트래퍼(boot/) 부팅 설정에 따른 비활성화 가드
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  if (bootCfg && !bootCfg.grandFleet) return;

  const log = getLogAPI();

  const role = detectRole();
  if (!role) {
    log.debug("grand-fleet", "PI_GRAND_FLEET_ROLE 미설정 — 단일 함대 모드");
    return;
  }

  log.info("grand-fleet", `역할 감지: ${role}`);
  initState(role);

  if (role === "admiralty") {
    log.info("grand-fleet", "Admiralty 모드 초기화");
    registerAdmiralty(pi);
  } else {
    log.info("grand-fleet", `Fleet 모드 초기화 — fleetId=${process.env.PI_FLEET_ID}`);
    registerFleet(pi);
  }
}

/** globalThis에서 Grand Fleet 상태를 안전하게 조회 */
export function getState(): GrandFleetState {
  return (globalThis as any)[GRAND_FLEET_STATE_KEY] as GrandFleetState;
}

/** 환경변수에서 역할 감지 */
function detectRole(): GrandFleetRole | null {
  const roleEnv = process.env.PI_GRAND_FLEET_ROLE;
  if (roleEnv === "admiralty" || roleEnv === "fleet") return roleEnv;
  return null;
}

/** globalThis 상태 초기화 (lazy-init guard) */
function initState(role: GrandFleetRole): void {
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
