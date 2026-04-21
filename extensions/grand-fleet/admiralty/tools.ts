import * as crypto from "node:crypto";
import * as fs from "node:fs";
import type { Socket } from "node:net";
import * as path from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { getLogAPI } from "../../core/log/bridge.js";
import * as tmux from "../formation/tmux.js";
import { getState } from "../index.js";
import type { AdmiraltyServer } from "../ipc/server.js";
import type { CarrierMap, ConnectedFleet, FleetStatus, MissionId } from "../types.js";
import type { FleetRegistry } from "./fleet-registry.js";
import { syncRosterWidget } from "./roster-widget.js";

interface DeployParams {
  designation: string;
  directory: string;
}

interface DeployResult {
  designation: string;
  directory: string;
  fleetId: string;
  reused: boolean;
  sessionName: string;
  windowName: string;
}

interface DispatchParams {
  fleetId: string;
  directive: string;
  priority?: string;
}

interface RecallParams {
  fleetId: string;
}

interface BroadcastParams {
  directive: string;
  priority?: string;
}

interface StatusParams {
  fleetId?: string;
}

interface RegistryFleetRecord {
  cost: number;
  carriers: CarrierMap;
  connected: boolean;
  designation: string;
  directory: string;
  id: string;
  activeMissionId: MissionId | null;
  socket?: Socket;
  status: FleetStatus | string;
}

interface RegistryLike {
  getSocket?(fleetId: string): Socket | undefined;
}

interface MissionAck {
  acknowledgement: unknown;
  designation: string;
  fleetId: string;
  missionId: string;
  priority: string;
}

interface FleetStatusView {
  activeMissionId: string | null;
  connected: boolean;
  cost: number;
  designation: string;
  directory: string;
  fleetId: string;
  carrierStatus: CarrierMap;
  status: string;
}

interface RecallSnapshot {
  activeMissionId: string | null;
  activeMissionObjective: string | null;
  designation: string;
  directory: string;
  fleetId: string;
  status: string;
}

const DEFAULT_PRIORITY = "normal";
const LOG_SOURCE = "grand-fleet";
const DEPLOY_SESSION_NAME = "grand-fleet-admiralty";

const DeployParamsSchema = Type.Object({
  directory: Type.String({
    minLength: 1,
    description: "함대를 파견할 대상 하위 디렉토리 경로",
  }),
  designation: Type.String({
    minLength: 1,
    description: "함대 표시명. UI와 프롬프트에 노출되는 식별명",
  }),
});

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

const RecallParamsSchema = Type.Object({
  fleetId: Type.String({
    minLength: 1,
    description: "철수시킬 함대 식별자",
  }),
});

let runtimeRegistry: (() => FleetRegistry) | null = null;
let runtimeServer: (() => AdmiraltyServer) | null = null;

export function setAdmiraltyRuntime(
  getRegistry: () => FleetRegistry,
  getServer: () => AdmiraltyServer,
): void {
  runtimeRegistry = getRegistry;
  runtimeServer = getServer;
}

export function registerAdmiraltyTools(
  pi: ExtensionAPI,
): void {
  pi.registerTool({
    name: "grand_fleet_deploy",
    label: "Grand Fleet Deploy",
    description: "Admiral of the Navy (대원수)의 지시에 따라 대상 하위 디렉토리에 Fleet PI를 파견하거나 기존 Fleet을 재사용한다.",
    parameters: DeployParamsSchema as any,
    async execute(_toolCallId: string, params: DeployParams) {
      const log = getLogAPI();
      const { registry } = requireRuntime();

      log.info(
        LOG_SOURCE,
        `deploy: ${params.designation} ← ${params.directory}`,
      );

      const result = await deployFleet(registry, params);
      syncRosterWidget();

      return {
        content: [{
          type: "text" as const,
          text: result.reused
            ? `Fleet 재사용: ${result.designation} (${result.fleetId})`
            : `Fleet 파견 완료: ${result.designation} (${result.fleetId})`,
        }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "grand_fleet_dispatch",
    label: "Grand Fleet Dispatch",
    description: "Admiral of the Navy (대원수)의 명령을 특정 함대에 작전으로 하달한다.",
    parameters: DispatchParamsSchema as any,
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
          acknowledgement,
          designation: fleet.designation,
          fleetId: fleet.id,
          missionId,
          priority,
        };

        return {
          content: [{
            type: "text" as const,
            text: `작전 수령 확인: ${fleet.designation} (${fleet.id}) <- ${missionId} (${priority})`,
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
    name: "grand_fleet_recall",
    label: "Grand Fleet Recall",
    description: "Admiral of the Navy (대원수)의 철수 명령에 따라 특정 함대를 회수하고 진행 중인 임무를 중단한다.",
    parameters: RecallParamsSchema as any,
    async execute(_toolCallId: string, params: RecallParams) {
      const log = getLogAPI();
      const { registry } = requireRuntime();
      const fleet = requireFleetRecord(registry, params.fleetId);
      const snapshot = createRecallSnapshot(fleet);

      log.warn(
        LOG_SOURCE,
        `recall: ${snapshot.designation} (${snapshot.fleetId})`,
      );

      try {
        await tmux.killWindow(DEPLOY_SESSION_NAME, params.fleetId);
      } catch (error) {
        log.error(
          LOG_SOURCE,
          `recall 실패: Fleet ${params.fleetId} — ${toErrorMessage(error)}`,
        );
        throw error;
      }

      return {
        content: [{
          type: "text" as const,
          text: `함대 철수 명령 전송: ${snapshot.designation} (${snapshot.fleetId})`,
        }],
        details: {
          recalled: true,
          snapshot,
        },
      };
    },
  });

  pi.registerTool({
    name: "grand_fleet_broadcast",
    label: "Grand Fleet Broadcast",
    description: "Admiral of the Navy (대원수)의 공통 명령을 연결된 모든 함대에 동시에 하달한다.",
    parameters: BroadcastParamsSchema as any,
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
            acknowledgement,
            designation: fleet.designation,
            fleetId: fleet.id,
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
          acknowledgements,
          missionId,
          priority,
        },
      };
    },
  });

  pi.registerTool({
    name: "grand_fleet_status",
    label: "Grand Fleet Status",
    description: "Admiral of the Navy (대원수)에게 보고할 함대별 상태, carrier 가동 현황, 비용을 조회한다.",
    parameters: StatusParamsSchema as any,
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

function requireRuntime(): { registry: FleetRegistry; server: AdmiraltyServer } {
  if (!runtimeRegistry || !runtimeServer) {
    throw new Error("Grand Fleet command runtime이 초기화되지 않았습니다.");
  }
  return { registry: runtimeRegistry(), server: runtimeServer() };
}

async function deployFleet(
  registry: FleetRegistry,
  params: DeployParams,
): Promise<DeployResult> {
  const socketPath = getState().socketPath;
  if (!socketPath) {
    throw new Error("Admiralty 소켓 경로가 초기화되지 않았습니다.");
  }

  if (!(await tmux.checkTmuxAvailable())) {
    throw new Error("tmux가 설치되어 있지 않습니다.");
  }

  const designation = normalizeDesignation(params.designation);
  const directory = resolveFleetDirectory(params.directory);
  const fleetId = createFleetId(directory);
  const existingFleet = registry.getFleetByDirectory(directory);
  const designationConflict = registry.hasDesignationConflict(designation, fleetId);

  if (designationConflict) {
    throw new Error(
      `이미 다른 함대가 designation을 사용 중입니다: ${designation} (${designationConflict.id})`,
    );
  }

  if (existingFleet && registry.getSocket(existingFleet.id)) {
    return {
      designation: existingFleet.designation,
      directory,
      fleetId: existingFleet.id,
      reused: true,
      sessionName: DEPLOY_SESSION_NAME,
      windowName: existingFleet.id,
    };
  }

  await ensureDeploySession();

  if (await tmux.hasWindow(DEPLOY_SESSION_NAME, fleetId)) {
    await tmux.killWindow(DEPLOY_SESSION_NAME, fleetId);
  }

  const command = buildFleetCommand({
    designation,
    directory,
    fleetId,
    socketPath,
  });

  try {
    await tmux.createCommandWindow(DEPLOY_SESSION_NAME, fleetId, command);
  } catch (error) {
    throw new Error(`Fleet 파견 실패: ${toErrorMessage(error)}`);
  }

  return {
    designation,
    directory,
    fleetId,
    reused: false,
    sessionName: DEPLOY_SESSION_NAME,
    windowName: fleetId,
  };
}

async function ensureDeploySession(): Promise<void> {
  const alreadyExists = await tmux.hasSession(DEPLOY_SESSION_NAME);
  await tmux.ensureSession(DEPLOY_SESSION_NAME);

  if (!alreadyExists && !(await tmux.hasWindow(DEPLOY_SESSION_NAME, "Admiralty"))) {
    try {
      await tmux.createWindow(DEPLOY_SESSION_NAME, "Admiralty");
    } catch {
      // 초기 세션 생성 시 기본 윈도우가 이미 존재할 수 있다.
    }
  }
}

function normalizePriority(priority?: string): string {
  return priority?.trim() || DEFAULT_PRIORITY;
}

function normalizeDesignation(designation: string): string {
  const normalized = designation.trim();
  if (!normalized) {
    throw new Error("designation은 비어 있을 수 없습니다.");
  }
  return normalized;
}

function resolveFleetDirectory(inputDirectory: string): string {
  const projectRoot = fs.realpathSync.native(process.cwd());
  const candidatePath = path.resolve(projectRoot, inputDirectory);

  let directory: string;
  try {
    directory = fs.realpathSync.native(candidatePath);
  } catch {
    throw new Error(`대상 디렉토리가 존재하지 않습니다: ${inputDirectory}`);
  }

  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) {
    throw new Error(`대상 경로가 디렉토리가 아닙니다: ${inputDirectory}`);
  }

  const relative = path.relative(projectRoot, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("directory는 현재 프로젝트 루트의 하위 디렉토리여야 합니다.");
  }

  return directory;
}

function createFleetId(directory: string): string {
  const hash = crypto.createHash("sha256").update(directory).digest("hex").slice(0, 12);
  const base = path.basename(directory).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const safeBase = base || "fleet";
  return `${safeBase}-${hash}`;
}

function buildFleetCommand(args: {
  designation: string;
  directory: string;
  fleetId: string;
  socketPath: string;
}): string {
  const envSegments = [
    "PI_GRAND_FLEET_ROLE=fleet",
    `PI_FLEET_ID=${quoteForShell(args.fleetId)}`,
    `PI_FLEET_DESIGNATION=${quoteForShell(args.designation)}`,
    `PI_GRAND_FLEET_SOCK=${quoteForShell(args.socketPath)}`,
  ];

  return `cd ${quoteForShell(args.directory)} && env ${envSegments.join(" ")} pi`;
}

function quoteForShell(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
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
  const designation =
    typeof candidate.designation === "string" && candidate.designation.trim()
      ? candidate.designation
      : id;
  const directory =
    typeof candidate.operationalZone === "string" && candidate.operationalZone.length > 0
      ? candidate.operationalZone
      : "";
  const connected =
    typeof candidate.connected === "boolean"
      ? candidate.connected
      : socket !== undefined;

  return {
    activeMissionId,
    carriers,
    connected,
    cost,
    designation,
    directory,
    id,
    status,
    socket,
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
  throw new Error(`연결되지 않은 함대입니다: ${fleet.designation} (${fleet.id})`);
}

function attachFleetSocket(
  registry: FleetRegistry,
  fleet: RegistryFleetRecord,
): RegistryFleetRecord {
  const registryLike = registry as unknown as RegistryLike;
  const socket = registryLike.getSocket?.(fleet.id) ?? fleet.socket;

  return {
    ...fleet,
    connected: socket !== undefined,
    socket,
  };
}

function toFleetStatusView(fleet: RegistryFleetRecord): FleetStatusView {
  return {
    activeMissionId: fleet.activeMissionId,
    connected: fleet.connected,
    cost: fleet.cost,
    designation: fleet.designation,
    directory: fleet.directory,
    fleetId: fleet.id,
    carrierStatus: fleet.carriers,
    status: fleet.status,
  };
}

function createRecallSnapshot(fleet: RegistryFleetRecord): RecallSnapshot {
  return {
    activeMissionId: fleet.activeMissionId,
    activeMissionObjective:
      getState().connectedFleets.get(fleet.id)?.activeMissionObjective ?? null,
    designation: fleet.designation,
    directory: fleet.directory,
    fleetId: fleet.id,
    status: fleet.status,
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
      return `${fleet.designation} (${fleet.fleetId}): status=${fleet.status}, connected=${fleet.connected}, carriers=${carrierCount}, cost=${fleet.cost}, mission=${mission}, dir=${fleet.directory}`;
    })
    .join("\n");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
