/**
 * fleet/register.ts — Fleet 모드 와이어링
 *
 * Admiralty에 IPC 클라이언트로 접속하고, Grand Fleet Context를
 * 시스템 프롬프트에 append하며, 명령 수신 시 Admiral에 주입한다.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getLogAPI } from "../../core/log/bridge.js";
import { getState } from "../index.js";
import { FleetClient } from "../ipc/client.js";
import { registerFleetHandlers } from "../ipc/methods.js";
import { buildFleetContextPrompt } from "../prompts.js";
import {
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  type CarrierInfo,
  type CarrierMap,
  type CarrierStatus,
  type CliBackend,
  type FleetId,
  type FleetStatus,
} from "../types.js";

interface FleetRegisterPayload {
  fleetId: FleetId;
  designation: string;
  operationalZone: string;
  sessionId: string;
  protocolVersion: string;
  carriers: CarrierMap;
}

interface FleetPingPayload {
  activeMissionId: string | null;
  activeMissionObjective: string | null;
  carriers: CarrierMap;
  cost: number;
  fleetId: FleetId;
  fleetStatus: FleetStatus;
  uptime: number;
}

interface FleetOverlayRuntimeState {
  activeMissionId: string | null;
  activeMissionObjective: string | null;
  carriers: CarrierMap;
  connectionState: "disconnected" | "connecting" | "connected";
  designation: string | null;
  fleetStatus: FleetStatus;
  heartbeatAgeMs: number | null;
  socketPath: string | null;
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

const LOG_SOURCE = "grand-fleet";
const CARRIER_FRAMEWORK_KEY = "__pi_bridge_framework__";
const STREAM_STORE_KEY = "__pi_stream_store__";
const STATUS_SYNC_INTERVAL_MS = 1_000;

let client: FleetClient | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let statusSyncTimer: ReturnType<typeof setInterval> | null = null;
let lastHeartbeatAt: number | null = null;
let lastStatusSignature: string | null = null;

export default function registerFleet(pi: ExtensionAPI): void {
  const state = getState();
  const fleetId = state?.fleetId ?? "unset";
  const log = getLogAPI();
  const socketPath = state?.socketPath ?? "unset";

  log.info(LOG_SOURCE, `Fleet 모드 초기화: fleetId=${fleetId}, socket=${socketPath}`);

  pi.on("before_agent_start", (event) => {
    if (!client || client.getState() !== "connected") return;
    const context = buildFleetContextPrompt(
      fleetId,
      state.designation ?? fleetId,
      process.cwd(),
    );
    return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
  });

  pi.registerCommand("fleet:grand-fleet:connect", {
    description: "Admiralty에 접속 — Grand Fleet에 합류",
    handler: async (_args, ctx) => {
      if (client) {
        ctx.ui.notify("[Grand Fleet] 이미 연결되어 있습니다.", "warning");
        return;
      }

      const inputFleetId = await ctx.ui.input(
        "함대 이름 (Fleet ID):",
        process.cwd().split("/").pop() ?? "fleet",
      );
      if (inputFleetId === undefined || !inputFleetId.trim()) {
        ctx.ui.notify("접속이 취소되었습니다.", "warning");
        return;
      }

      const inputPath = await ctx.ui.input(
        "Admiralty 소켓 경로:",
        "~/.pi/grand-fleet/admiralty.sock",
      );
      if (inputPath === undefined || !inputPath.trim()) {
        ctx.ui.notify("접속이 취소되었습니다.", "warning");
        return;
      }

      const inputDesignation = await ctx.ui.input(
        "함대 표시명 (Designation):",
        state.designation ?? inputFleetId.trim(),
      );
      if (inputDesignation === undefined || !inputDesignation.trim()) {
        ctx.ui.notify("접속이 취소되었습니다.", "warning");
        return;
      }

      const effectiveFleetId = inputFleetId.trim();
      if (state) {
        state.socketPath = inputPath.trim();
        state.fleetId = effectiveFleetId;
        state.designation = inputDesignation.trim();
      }

      connectToAdmiralty(inputPath.trim(), effectiveFleetId, pi, ctx);
    },
  });

  pi.registerCommand("fleet:grand-fleet:disconnect", {
    description: "Admiralty 연결 해제 — Grand Fleet에서 이탈",
    handler: async (_args, ctx) => {
      if (!client) {
        ctx.ui.notify("[Grand Fleet] 연결되어 있지 않습니다.", "warning");
        return;
      }

      log.info(LOG_SOURCE, "Fleet 수동 연결 해제");
      stopHeartbeat();
      stopFleetStatusSync();
      client.sendNotification("fleet.deregister", {
        fleetId: state?.fleetId ?? fleetId,
        reason: "user_request",
      });
      client.close();
      client = null;
      state.activeMissionId = null;
      state.activeMissionObjective = null;
      lastHeartbeatAt = null;
      lastStatusSignature = null;
      ctx.ui.notify("[Grand Fleet] Admiralty 연결 해제 완료", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (state.socketPath && state.fleetId) {
      connectToAdmiralty(state.socketPath, state.fleetId, pi, ctx);
    }
  });

  let missionTexts: string[] = [];

  pi.on("message_end", async (event) => {
    if (!state.activeMissionId || !client) return;

    const msg: any = event.message;
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return;

    const turnText = msg.content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();

    if (turnText) {
      missionTexts.push(turnText);
    }

    const hasToolUse = msg.content.some((c: any) => c?.type === "tool_use");
    if (hasToolUse) {
      flushFleetStatus(state.fleetId ?? fleetId);
      return;
    }

    const summary = missionTexts.join("\n\n---\n\n");
    if (!summary) return;

    const missionId = state.activeMissionId;
    log.info(LOG_SOURCE, `작전 보고 전송: missionId=${missionId}, ${missionTexts.length}개 턴 누적, ${summary.length}자`);

    client.sendNotification("mission.report", {
      fleetId,
      missionId,
      type: "complete",
      summary,
      timestamp: new Date().toISOString(),
    });

    state.activeMissionId = null;
    state.activeMissionObjective = null;
    missionTexts = [];
    flushFleetStatus(state.fleetId ?? fleetId, true);
  });

  pi.on("session_shutdown", async () => {
    stopHeartbeat();
    stopFleetStatusSync();
    if (!client) {
      return;
    }

    log.info(LOG_SOURCE, "Fleet 종료: deregister 전송");
    client.sendNotification("fleet.deregister", {
      fleetId,
      reason: "shutdown",
    });
    client.close();
    client = null;
    lastHeartbeatAt = null;
    lastStatusSignature = null;
  });
}

export function getFleetOverlayRuntimeState(): FleetOverlayRuntimeState {
  const state = getState();
  const ping = buildFleetPingPayload(state.fleetId ?? "unset");
  return {
    activeMissionId: ping.activeMissionId,
    activeMissionObjective: ping.activeMissionObjective,
    carriers: ping.carriers,
    connectionState: client?.getState() ?? "disconnected",
    designation: state.designation,
    fleetStatus: ping.fleetStatus,
    heartbeatAgeMs: lastHeartbeatAt === null ? null : Date.now() - lastHeartbeatAt,
    socketPath: state.socketPath,
  };
}

function connectToAdmiralty(
  socketPath: string,
  fleetIdToUse: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): void {
  const state = getState();
  const log = getLogAPI();

  if (client) {
    ctx.ui.notify("[Grand Fleet] 이미 연결되어 있습니다.", "warning");
    return;
  }

  client = new FleetClient(socketPath);

  client.onConnect(async () => {
    log.info(LOG_SOURCE, "Admiralty 접속 완료");
    ctx.ui.notify("[Grand Fleet] Admiralty 접속 완료", "info");

    try {
      log.debug(LOG_SOURCE, "fleet.register 전송");
      await client?.sendRequest(
        "fleet.register",
        buildFleetRegisterPayload(fleetIdToUse) as unknown as Record<string, unknown>,
      );
      log.info(LOG_SOURCE, "fleet.register 성공");
      lastStatusSignature = null;
      flushFleetStatus(fleetIdToUse, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(LOG_SOURCE, `fleet.register 실패: ${message}`);
      ctx.ui.notify(`[Grand Fleet] 등록 실패: ${message}`, "error");
    }

    startHeartbeat(fleetIdToUse);
    startFleetStatusSync(fleetIdToUse);
  });

  client.onDisconnect(() => {
    log.warn(LOG_SOURCE, "Admiralty 연결 끊김");
    ctx.ui.notify("[Grand Fleet] Admiralty 연결 끊김", "warning");
    stopHeartbeat();
    stopFleetStatusSync();
  });

  registerFleetHandlers(client, {
    onMissionAssign: async (params) => {
      const objective = String(params.objective ?? "");
      const missionId = String(params.missionId ?? "");
      log.info(
        LOG_SOURCE,
        `작전 수령: missionId=${missionId}, objective=${objective.slice(0, 80)}`,
      );
      state.activeMissionId = missionId;
      state.activeMissionObjective = objective || null;
      flushFleetStatus(fleetIdToUse, true);
      pi.sendUserMessage(objective, { deliverAs: "followUp" });
      return { accepted: true, missionId };
    },
    onMissionAbort: async (params) => {
      log.warn(LOG_SOURCE, `작전 중단 수신: missionId=${String(params.missionId ?? "")}`);
      state.activeMissionId = null;
      state.activeMissionObjective = null;
      flushFleetStatus(fleetIdToUse, true);
      return { aborted: true, missionId: String(params.missionId ?? "") };
    },
    onSessionNew: async () => {
      return { sessionId: `session-${Date.now()}` };
    },
    onSessionResume: async (params) => {
      return { resumed: true, sessionId: String(params.sessionId ?? "") };
    },
    onSessionSuspend: async () => {
      state.activeMissionId = null;
      state.activeMissionObjective = null;
      flushFleetStatus(fleetIdToUse, true);
      return { suspended: true, sessionId: "current" };
    },
    onFleetPing: async () => {
      return buildFleetPingPayload(fleetIdToUse);
    },
  });

  client.connect();
}

function buildFleetRegisterPayload(fleetId: FleetId): FleetRegisterPayload {
  const state = getState();
  return {
    fleetId,
    designation: state.designation ?? fleetId,
    operationalZone: process.cwd(),
    sessionId: `session-${Date.now()}`,
    protocolVersion: PROTOCOL_VERSION,
    carriers: collectCarrierMap(),
  };
}

function buildFleetPingPayload(fleetId: FleetId): FleetPingPayload {
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

function startHeartbeat(fleetId: FleetId): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    lastHeartbeatAt = Date.now();
    getLogAPI().debug(
      LOG_SOURCE,
      `heartbeat 전송: fleetId=${fleetId}`,
      { hideFromFooter: true },
    );
    client?.sendNotification("fleet.heartbeat", {
      fleetId,
      uptime: Math.floor(process.uptime()),
      activeMissionId: getState().activeMissionId,
      activeMissionObjective: getState().activeMissionObjective,
      cost: 0,
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (!heartbeatTimer) {
    return;
  }

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  lastHeartbeatAt = null;
}

function startFleetStatusSync(fleetId: FleetId): void {
  stopFleetStatusSync();
  statusSyncTimer = setInterval(() => {
    flushFleetStatus(fleetId);
  }, STATUS_SYNC_INTERVAL_MS);
}

function stopFleetStatusSync(): void {
  if (!statusSyncTimer) {
    return;
  }

  clearInterval(statusSyncTimer);
  statusSyncTimer = null;
  lastStatusSignature = null;
}

function flushFleetStatus(fleetId: FleetId, force = false): void {
  if (!client || client.getState() !== "connected") {
    return;
  }

  const payload = buildFleetPingPayload(fleetId);
  const signature = JSON.stringify(payload);
  if (!force && signature === lastStatusSignature) {
    return;
  }

  lastStatusSignature = signature;
  client.sendNotification("fleet.status", payload as unknown as Record<string, unknown>);
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
