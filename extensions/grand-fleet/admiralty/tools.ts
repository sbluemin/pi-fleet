import type { Socket } from "node:net";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { getLogAPI } from "../../core/log/bridge.js";
import { getState } from "../index.js";
import type { AdmiraltyServer } from "../ipc/server.js";
import type { CarrierMap, ConnectedFleet, FleetStatus, MissionId } from "../types.js";
import type { FleetRegistry } from "./fleet-registry.js";
import { syncRosterWidget } from "./roster-widget.js";

interface DispatchParams {
  fleetId: string;
  directive: string;
  priority?: string;
}

interface BroadcastParams {
  directive: string;
  priority?: string;
}

interface StatusParams {
  fleetId?: string;
}

interface RegistryFleetRecord {
  id: string;
  status: FleetStatus | string;
  carriers: CarrierMap;
  cost: number;
  activeMissionId: MissionId | null;
  socket?: Socket;
  connected: boolean;
}

interface RegistryLike {
  getSocket?(fleetId: string): Socket | undefined;
}

interface MissionAck {
  fleetId: string;
  missionId: string;
  priority: string;
  acknowledgement: unknown;
}

interface FleetStatusView {
  fleetId: string;
  status: string;
  connected: boolean;
  activeMissionId: string | null;
  carrierStatus: CarrierMap;
  cost: number;
}

const DEFAULT_PRIORITY = "normal";
const LOG_SOURCE = "grand-fleet:admiralty";

const DispatchParamsSchema = Type.Object({
  fleetId: Type.String({
    minLength: 1,
    description: "작전을 하달할 함대 식별자",
  }),
  directive: Type.String({
    minLength: 1,
    description: "함대에 전달할 작전 지시",
  }),
  priority: Type.Optional(Type.String({
    default: DEFAULT_PRIORITY,
    description: "작전 우선순위",
  })),
});

const BroadcastParamsSchema = Type.Object({
  directive: Type.String({
    minLength: 1,
    description: "전 함대에 전달할 공통 작전 지시",
  }),
  priority: Type.Optional(Type.String({
    default: DEFAULT_PRIORITY,
    description: "작전 우선순위",
  })),
});

const StatusParamsSchema = Type.Object({
  fleetId: Type.Optional(Type.String({
    minLength: 1,
    description: "특정 함대 식별자. 생략 시 전체 함대 현황을 반환",
  })),
});

/** Admiralty 런타임 참조 — launchGrandFleet 시점에 주입됨 */
let runtimeRegistry: (() => FleetRegistry) | null = null;
let runtimeServer: (() => AdmiraltyServer) | null = null;

/** 런타임 참조를 주입한다. (auto-subdirs.ts의 startAdmiraltyServer에서 호출) */
export function setAdmiraltyRuntime(
  getRegistry: () => FleetRegistry,
  getServer: () => AdmiraltyServer,
): void {
  runtimeRegistry = getRegistry;
  runtimeServer = getServer;
}

function requireRuntime(): { registry: FleetRegistry; server: AdmiraltyServer } {
  if (!runtimeRegistry || !runtimeServer) {
    throw new Error("Grand Fleet이 활성화되지 않았습니다. /fleet:grand-fleet:start를 먼저 실행하세요.");
  }
  return { registry: runtimeRegistry(), server: runtimeServer() };
}

export function registerAdmiraltyTools(
  pi: ExtensionAPI,
): void {
  pi.registerTool({
    name: "grand_fleet_dispatch",
    label: "Grand Fleet Dispatch",
    description: "특정 함대에 작전을 하달한다.",
    parameters: DispatchParamsSchema,
    async execute(_toolCallId: string, params: DispatchParams) {
      const log = getLogAPI();
      const { registry, server } = requireRuntime();
      const priority = normalizePriority(params.priority);
      const missionId = createMissionId();
      log.info(
        LOG_SOURCE,
        `dispatch: Fleet ${params.fleetId} ← ${summarizeDirective(params.directive)}`,
      );

      try {
        const fleet = requireFleetRecord(registry, params.fleetId);
        const socket = requireFleetSocket(fleet);

        const acknowledgement = await server.sendRequest(
          socket,
          "mission.assign",
          {
            missionId,
            objective: params.directive,
            priority,
          },
          Date.now(),
        );

        const fleetState = getState().connectedFleets.get(params.fleetId);
        if (fleetState) {
          fleetState.activeMissionId = missionId;
          fleetState.activeMissionObjective = params.directive.slice(0, 40);
          syncRosterWidget();
        }

        log.debug(LOG_SOURCE, `dispatch 완료: ${missionId}`);

        const result: MissionAck = {
          fleetId: fleet.id,
          missionId,
          priority,
          acknowledgement,
        };

        return {
          content: [{
            type: "text" as const,
            text: `작전 수령 확인: ${fleet.id} <- ${missionId} (${priority})`,
          }],
          details: result,
        };
      } catch (error) {
        log.error(
          LOG_SOURCE,
          `dispatch 실패: Fleet ${params.fleetId} — ${toErrorMessage(error)}`,
        );
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "grand_fleet_broadcast",
    label: "Grand Fleet Broadcast",
    description: "연결된 모든 함대에 동일한 작전을 동시에 하달한다.",
    parameters: BroadcastParamsSchema,
    async execute(_toolCallId: string, params: BroadcastParams) {
      const log = getLogAPI();
      const { registry, server } = requireRuntime();
      const priority = normalizePriority(params.priority);
      const missionId = createMissionId();
      const fleets = listConnectedFleetRecords(registry);

      log.info(LOG_SOURCE, `broadcast: ${fleets.length}개 함대에 작전 하달`);

      const acknowledgements = await Promise.all(
        fleets.map(async (fleet, index) => {
          const socket = requireFleetSocket(fleet);
          const acknowledgement = await server.sendRequest(
            socket,
            "mission.assign",
            {
              missionId,
              objective: params.directive,
              priority,
            },
            Date.now() + index,
          );

          return {
            fleetId: fleet.id,
            acknowledgement,
          };
        }),
      );

      const objectivePreview = params.directive.slice(0, 40);
      for (const ack of acknowledgements) {
        const fleetState = getState().connectedFleets.get(ack.fleetId);
        if (fleetState) {
          fleetState.activeMissionId = missionId;
          fleetState.activeMissionObjective = objectivePreview;
        }
      }
      syncRosterWidget();

      return {
        content: [{
          type: "text" as const,
          text: `전 함대 동시 하달 완료: ${acknowledgements.length}개 함대, ${missionId} (${priority})`,
        }],
        details: {
          missionId,
          priority,
          acknowledgements,
        },
      };
    },
  });

  pi.registerTool({
    name: "grand_fleet_status",
    label: "Grand Fleet Status",
    description: "함대별 상태, carrier 가동 현황, 비용을 조회한다.",
    parameters: StatusParamsSchema,
    async execute(_toolCallId: string, params: StatusParams) {
      const log = getLogAPI();
      const { registry } = requireRuntime();
      const fleets = params.fleetId
        ? [requireFleetRecord(registry, params.fleetId)]
        : listAllFleetRecords(registry);
      const status = fleets.map(toFleetStatusView);

      log.debug(
        LOG_SOURCE,
        `status 조회: ${params.fleetId ? `Fleet ${params.fleetId}` : `${status.length}개 함대 전체`}`,
      );

      return {
        content: [{
          type: "text" as const,
          text: formatStatusSummary(status),
        }],
        details: {
          fleets: status,
        },
      };
    },
  });
}

function normalizePriority(priority?: string): string {
  return priority?.trim() || DEFAULT_PRIORITY;
}

function createMissionId(): string {
  return `mission-${Date.now()}`;
}

function summarizeDirective(directive: string): string {
  const normalized = directive.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 50);
}

function requireFleetRecord(
  registry: FleetRegistry,
  fleetId: string,
): RegistryFleetRecord {
  // 전역 상태를 함대 메타데이터의 기준 저장소로 사용한다.
  const directMatch = getState().connectedFleets.get(fleetId);
  const normalized = normalizeFleetRecord(directMatch, fleetId);

  if (!normalized) {
    getLogAPI().warn(LOG_SOURCE, `함대 미등록: ${fleetId}`);
    throw new Error(`등록되지 않은 함대입니다: ${fleetId}`);
  }

  return attachFleetSocket(registry, normalized);
}

function listConnectedFleetRecords(registry: FleetRegistry): RegistryFleetRecord[] {
  return Array.from(getState().connectedFleets.values())
    .map((fleet) => normalizeFleetRecord(fleet, fleet.id))
    .filter((fleet): fleet is RegistryFleetRecord => Boolean(fleet))
    .map((fleet) => attachFleetSocket(registry, fleet))
    .filter((fleet) => fleet.connected);
}

function listAllFleetRecords(registry: FleetRegistry): RegistryFleetRecord[] {
  return Array.from(getState().connectedFleets.values())
    .map((fleet) => normalizeFleetRecord(fleet, fleet.id))
    .filter((fleet): fleet is RegistryFleetRecord => Boolean(fleet))
    .map((fleet) => attachFleetSocket(registry, fleet));
}

function normalizeFleetRecord(
  value: unknown,
  fallbackId: string,
): RegistryFleetRecord | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<ConnectedFleet> & Record<string, unknown>;
  const socket = pickSocket(candidate);
  const carriers = isCarrierMap(candidate.carriers) ? candidate.carriers : {};
  const status = typeof candidate.status === "string" ? candidate.status : "idle";
  const cost = typeof candidate.cost === "number" ? candidate.cost : 0;
  const activeMissionId =
    typeof candidate.activeMissionId === "string" ? candidate.activeMissionId : null;
  const id = typeof candidate.id === "string" && candidate.id.length > 0
    ? candidate.id
    : fallbackId;
  const connected =
    typeof candidate.connected === "boolean"
      ? candidate.connected
      : socket !== undefined;

  return {
    id,
    status,
    carriers,
    cost,
    activeMissionId,
    socket,
    connected,
  };
}

function pickSocket(candidate: Record<string, unknown>): Socket | undefined {
  const socketCandidate =
    candidate.socket ??
    candidate.fleetSocket ??
    candidate.connection;

  return isSocket(socketCandidate) ? socketCandidate : undefined;
}

function isSocket(value: unknown): value is Socket {
  return Boolean(
    value &&
    typeof value === "object" &&
    "write" in value &&
    typeof (value as Socket).write === "function",
  );
}

function isCarrierMap(value: unknown): value is CarrierMap {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireFleetSocket(fleet: RegistryFleetRecord): Socket {
  if (fleet.socket) return fleet.socket;
  throw new Error(`연결되지 않은 함대입니다: ${fleet.id}`);
}

function attachFleetSocket(
  registry: FleetRegistry,
  fleet: RegistryFleetRecord,
): RegistryFleetRecord {
  // 실제 연결 소켓은 FleetRegistry가 별도 보관하므로 여기서 합친다.
  const registryLike = registry as unknown as RegistryLike;
  const socket = registryLike.getSocket?.(fleet.id) ?? fleet.socket;

  return {
    ...fleet,
    socket,
    connected: socket !== undefined,
  };
}

function toFleetStatusView(fleet: RegistryFleetRecord): FleetStatusView {
  return {
    fleetId: fleet.id,
    status: fleet.status,
    connected: fleet.connected,
    activeMissionId: fleet.activeMissionId,
    carrierStatus: fleet.carriers,
    cost: fleet.cost,
  };
}

function formatStatusSummary(fleets: FleetStatusView[]): string {
  if (fleets.length === 0) {
    return "조회 가능한 함대가 없습니다.";
  }

  return fleets
    .map((fleet) => {
      const carrierCount = Object.keys(fleet.carrierStatus).length;
      const mission = fleet.activeMissionId ?? "-";
      return `${fleet.fleetId}: status=${fleet.status}, connected=${fleet.connected}, carriers=${carrierCount}, cost=${fleet.cost}, mission=${mission}`;
    })
    .join("\n");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
