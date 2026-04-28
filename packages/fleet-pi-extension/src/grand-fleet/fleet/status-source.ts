import { getState } from "../index.js";
import {
  type CarrierInfo,
  type CarrierMap,
  type CarrierStatus,
  type CliBackend,
  type FleetId,
  type FleetStatus,
} from "../types.js";

interface FleetPingPayload {
  activeMissionId: string | null;
  activeMissionObjective: string | null;
  carriers: CarrierMap;
  cost: number;
  fleetId: FleetId;
  fleetStatus: FleetStatus;
  uptime: number;
}

interface FleetFrameworkLikeConfig {
  cliType?: string;
  displayName?: string;
}

interface FleetFrameworkLikeMode {
  config?: FleetFrameworkLikeConfig;
}

interface FleetFrameworkLikeState {
  modes?: Map<string, FleetFrameworkLikeMode>;
  registeredOrder?: string[];
  sortieDisabledCarriers?: Set<string>;
  squadronEnabledCarriers?: Set<string>;
  taskforceConfiguredCarriers?: Set<string>;
}

interface StreamRunLikeState {
  error?: string;
  requestPreview?: string;
  status?: string;
}

interface StreamStoreLikeState {
  runs?: Map<string, StreamRunLikeState>;
  visibleRunIdByCli?: Map<string, string>;
}

const CARRIER_FRAMEWORK_KEY = "__pi_bridge_framework__";
const STREAM_STORE_KEY = "__pi_stream_store__";

export function buildFleetPingPayload(fleetId: FleetId): FleetPingPayload {
  const state = getState();
  const carriers = collectCarrierMap();
  return {
    fleetId,
    fleetStatus: deriveFleetStatus(carriers),
    activeMissionId: state.activeMissionId,
    activeMissionObjective: state.activeMissionObjective,
    uptime: Math.floor(process.uptime()),
    cost: 0,
    carriers,
  };
}

function collectCarrierMap(): CarrierMap {
  const framework = getFleetFrameworkState();
  const runs = getVisibleRunMap();
  const carriers: CarrierMap = {};
  const order = framework.registeredOrder ?? [];

  for (const carrierId of order) {
    const mode = framework.modes?.get(carrierId);
    const cli = normalizeCliBackend(mode?.config?.cliType);
    const run = runs.get(carrierId);
    const isUnavailable = framework.sortieDisabledCarriers?.has(carrierId) ?? false;
    const isStandby = framework.squadronEnabledCarriers?.has(carrierId) ?? false;
    const status = deriveCarrierStatus(run?.status, isUnavailable, isStandby);
    const info: CarrierInfo = {
      status,
    };

    if (cli) {
      info.cli = cli;
    }

    const task = deriveCarrierTask(run);
    if (task) {
      info.task = task;
    }

    if (framework.taskforceConfiguredCarriers?.has(carrierId)) {
      info.tfConfigured = true;
    }

    carriers[carrierId] = info;
  }

  return carriers;
}

function deriveFleetStatus(carriers: CarrierMap): FleetStatus {
  const state = getState();
  if (state.activeMissionId) {
    return "active";
  }

  const carrierStatuses = Object.values(carriers).map((carrier) => carrier.status);
  if (carrierStatuses.some((status) => status === "error")) {
    return "error";
  }
  if (carrierStatuses.some((status) => status === "active")) {
    return "active";
  }
  return "idle";
}

function deriveCarrierStatus(
  runStatus: string | undefined,
  isUnavailable: boolean,
  isStandby: boolean,
): CarrierStatus {
  if (runStatus === "conn" || runStatus === "stream") {
    return "active";
  }
  if (runStatus === "err") {
    return "error";
  }
  if (runStatus === "done") {
    return "done";
  }
  if (isUnavailable) {
    return "unavailable";
  }
  if (isStandby) {
    return "standby";
  }
  return "idle";
}

function deriveCarrierTask(run: StreamRunLikeState | undefined): string | undefined {
  const requestPreview = run?.requestPreview?.trim();
  if (requestPreview) {
    return sanitizeTaskText(requestPreview);
  }
  const error = run?.error?.trim();
  return error ? sanitizeTaskText(error) : undefined;
}

function normalizeCliBackend(value: string | undefined): CliBackend | undefined {
  if (value === "claude" || value === "codex" || value === "gemini") {
    return value;
  }
  return undefined;
}

function getFleetFrameworkState(): FleetFrameworkLikeState {
  return ((globalThis as any)[CARRIER_FRAMEWORK_KEY] ?? {}) as FleetFrameworkLikeState;
}

function getVisibleRunMap(): Map<string, StreamRunLikeState> {
  const store = ((globalThis as any)[STREAM_STORE_KEY] ?? {}) as StreamStoreLikeState;
  const visibleRunMap = new Map<string, StreamRunLikeState>();
  const visibleRunIdByCli = store.visibleRunIdByCli;
  const runs = store.runs;

  if (!visibleRunIdByCli || !runs) {
    return visibleRunMap;
  }

  for (const [carrierId, runId] of visibleRunIdByCli.entries()) {
    const run = runs.get(runId);
    if (run) {
      visibleRunMap.set(carrierId, run);
    }
  }

  return visibleRunMap;
}

function sanitizeTaskText(value: string): string {
  const masked = value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED]")
    .replace(/ghp_[a-zA-Z0-9]{36,}/g, "[REDACTED]")
    .replace(/xox[bpras]-[a-zA-Z0-9-]+/g, "[REDACTED]")
    .replace(/\b[a-zA-Z0-9_-]{40,}\b/g, "[REDACTED]");

  return masked.slice(0, 80);
}
