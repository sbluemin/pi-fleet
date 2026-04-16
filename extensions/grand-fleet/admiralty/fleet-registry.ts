/**
 * Admiralty가 연결된 함대의 등록/해제, heartbeat, 상태, 소켓 참조를 관리한다.
 */
import type { Socket } from "node:net";

import { getLogAPI } from "../../core/log/bridge.js";
import type { FleetId, ConnectedFleet, CarrierMap } from "../types.js";
import {
  PROTOCOL_VERSION,
  HEARTBEAT_TIMEOUT_MS,
  GRAND_FLEET_ERRORS,
} from "../types.js";
import { getState } from "../index.js";

type RegisterParams = Record<string, unknown>;
type HeartbeatParams = Record<string, unknown>;
type StatusParams = Record<string, unknown>;
type ReportParams = Record<string, unknown>;

const HEARTBEAT_INTERVAL_SECONDS = 30;
const LOG_SOURCE = "grand-fleet:admiralty";

export class FleetRegistry {
  /** fleetId → Socket 매핑 (소켓 참조 보관) */
  private sockets = new Map<FleetId, Socket>();

  /** heartbeat 타이머 */
  private heartbeatTimers = new Map<FleetId, ReturnType<typeof setTimeout>>();

  /** 함대 등록 (fleet.register 핸들러) */
  async register(params: RegisterParams, socket: Socket): Promise<unknown> {
    const fleetId = params.fleetId as FleetId;
    const state = getState();
    const log = getLogAPI();

    try {
      if (state.connectedFleets.has(fleetId)) {
        log.warn(LOG_SOURCE, `Fleet ${fleetId} 중복 등록 검사 실패`);
        throw createRegistryError(
          GRAND_FLEET_ERRORS.FLEET_ALREADY_REGISTERED.code,
          GRAND_FLEET_ERRORS.FLEET_ALREADY_REGISTERED.message,
          { fleetId },
        );
      }

      if (params.protocolVersion !== PROTOCOL_VERSION) {
        log.warn(
          LOG_SOURCE,
          `Fleet ${fleetId} 프로토콜 버전 검사 실패 (expected=${PROTOCOL_VERSION}, actual=${String(params.protocolVersion)})`,
        );
        throw createRegistryError(
          GRAND_FLEET_ERRORS.PROTOCOL_VERSION_MISMATCH.code,
          GRAND_FLEET_ERRORS.PROTOCOL_VERSION_MISMATCH.message,
        );
      }

      const fleet: ConnectedFleet = {
        id: fleetId,
        operationalZone: params.operationalZone as string,
        sessionId: params.sessionId as string,
        protocolVersion: params.protocolVersion as string,
        carriers: ((params.carriers ?? {}) as CarrierMap),
        status: "idle",
        activeMissionId: null,
        cost: 0,
        lastHeartbeat: Date.now(),
      };

      state.connectedFleets.set(fleetId, fleet);
      this.sockets.set(fleetId, socket);
      this.startHeartbeatTimer(fleetId);

      log.info(
        LOG_SOURCE,
        `Fleet ${fleetId} 등록 완료 (zone=${fleet.operationalZone})`,
      );

      return {
        registered: true,
        protocolVersion: PROTOCOL_VERSION,
        heartbeatInterval: HEARTBEAT_INTERVAL_SECONDS,
      };
    } catch (error) {
      log.error(LOG_SOURCE, `Fleet ${fleetId} 등록 실패: ${toErrorMessage(error)}`);
      throw error;
    }
  }

  /** 함대 해제 */
  deregister(fleetId: FleetId): void {
    const state = getState();
    state.connectedFleets.delete(fleetId);
    this.sockets.delete(fleetId);
    this.clearHeartbeatTimer(fleetId);
    getLogAPI().info(LOG_SOURCE, `Fleet ${fleetId} 등록 해제`);
  }

  /** heartbeat 수신 */
  heartbeat(params: HeartbeatParams): void {
    const fleetId = params.fleetId as FleetId;
    const state = getState();
    const fleet = state.connectedFleets.get(fleetId);
    if (!fleet) return;

    fleet.lastHeartbeat = Date.now();
    fleet.cost = (params.cost as number | undefined) ?? fleet.cost;

    if (params.activeMissionId !== undefined) {
      fleet.activeMissionId = params.activeMissionId as string | null;
    }

    state.totalCost = calculateTotalCost();
    this.resetHeartbeatTimer(fleetId);
    getLogAPI().debug(LOG_SOURCE, `Fleet ${fleetId} heartbeat (cost=${fleet.cost})`);
  }

  /** Carrier 상태 업데이트 */
  updateStatus(params: StatusParams): void {
    const fleetId = params.fleetId as FleetId;
    const state = getState();
    const fleet = state.connectedFleets.get(fleetId);
    if (!fleet) return;

    fleet.status =
      (params.fleetStatus as ConnectedFleet["status"] | undefined) ??
      fleet.status;

    if (params.carriers) {
      Object.assign(fleet.carriers, params.carriers as CarrierMap);
    }

    getLogAPI().debug(LOG_SOURCE, `Fleet ${fleetId} 상태 변경: ${fleet.status}`);
  }

  /** 작전 보고 처리 */
  handleReport(params: ReportParams): void {
    const fleetId = params.fleetId as FleetId;
    const state = getState();
    const fleet = state.connectedFleets.get(fleetId);
    if (!fleet) return;

    const type = params.type as string;
    getLogAPI().info(LOG_SOURCE, `Fleet ${fleetId} 보고: ${type}`);
    if (type === "complete" || type === "failed") {
      fleet.activeMissionId = null;
      fleet.status = "idle";
    }
  }

  /** 함대 소켓 참조 조회 */
  getSocket(fleetId: FleetId): Socket | undefined {
    return this.sockets.get(fleetId);
  }

  /** 프롬프트용 로스터 생성 */
  getRoster(): Array<{ id: FleetId; zone: string; status: string }> {
    const state = getState();
    return Array.from(state.connectedFleets.values()).map((fleet) => ({
      id: fleet.id,
      zone: fleet.operationalZone,
      status: fleet.status,
    }));
  }

  /** heartbeat 감시 타이머를 시작한다. */
  private startHeartbeatTimer(fleetId: FleetId): void {
    this.heartbeatTimers.set(
      fleetId,
      setTimeout(() => {
        getLogAPI().warn(LOG_SOURCE, `Fleet ${fleetId} heartbeat 타임아웃 — 등록 해제`);
        this.deregister(fleetId);
      }, HEARTBEAT_TIMEOUT_MS),
    );
  }

  /** heartbeat 감시 타이머를 재시작한다. */
  private resetHeartbeatTimer(fleetId: FleetId): void {
    this.clearHeartbeatTimer(fleetId);
    this.startHeartbeatTimer(fleetId);
  }

  /** heartbeat 감시 타이머를 정리한다. */
  private clearHeartbeatTimer(fleetId: FleetId): void {
    const timer = this.heartbeatTimers.get(fleetId);
    if (!timer) return;

    clearTimeout(timer);
    this.heartbeatTimers.delete(fleetId);
  }
}

function calculateTotalCost(): number {
  const state = getState();
  return Array.from(state.connectedFleets.values()).reduce(
    (sum, fleet) => sum + fleet.cost,
    0,
  );
}

function createRegistryError(
  code: number,
  message: string,
  data?: Record<string, unknown>,
): Error & { code: number; data?: Record<string, unknown> } {
  return Object.assign(new Error(message), { code, data });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
