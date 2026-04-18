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
import { HEARTBEAT_INTERVAL_MS, PROTOCOL_VERSION } from "../types.js";
import type { FleetId } from "../types.js";

type FleetRegisterPayload = {
  fleetId: FleetId;
  operationalZone: string;
  sessionId: string;
  protocolVersion: string;
  carriers: Record<string, unknown>;
};

const LOG_SOURCE = "grand-fleet:fleet";

let client: FleetClient | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export default function registerFleet(pi: ExtensionAPI): void {
  const state = getState();
  const fleetId = state?.fleetId ?? "unset";
  const log = getLogAPI();
  const socketPath = state?.socketPath ?? "unset";

  log.info(LOG_SOURCE, `Fleet 모드 초기화: fleetId=${fleetId}, socket=${socketPath}`);

  pi.on("before_agent_start", (event) => {
    // 연결 상태일 때만 Grand Fleet Context 프롬프트 append
    if (!client || client.getState() !== "connected") return;
    const context = buildFleetContextPrompt(fleetId, process.cwd());
    return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
  });

  // Grand Fleet 접속/해제 슬래시 커맨드
  pi.registerCommand("fleet:grand-fleet:connect", {
    description: "Admiralty에 접속 — Grand Fleet에 합류",
    handler: async (_args, ctx) => {
      if (client) {
        ctx.ui.notify("[Grand Fleet] 이미 연결되어 있습니다.", "warning");
        return;
      }

      // 1단계: 함대 이름 입력
      const inputFleetId = await ctx.ui.input(
        "함대 이름 (Fleet ID):",
        process.cwd().split("/").pop() ?? "fleet",
      );
      if (inputFleetId === undefined || !inputFleetId.trim()) {
        ctx.ui.notify("접속이 취소되었습니다.", "warning");
        return;
      }

      // 2단계: 소켓 경로 입력
      const inputPath = await ctx.ui.input(
        "Admiralty 소켓 경로:",
        "~/.pi/grand-fleet/admiralty.sock",
      );
      if (inputPath === undefined || !inputPath.trim()) {
        ctx.ui.notify("접속이 취소되었습니다.", "warning");
        return;
      }

      const effectiveFleetId = inputFleetId.trim();
      if (state) {
        state.socketPath = inputPath.trim();
        state.fleetId = effectiveFleetId;
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
      client.sendNotification("fleet.deregister", {
        fleetId: state?.fleetId ?? fleetId,
        reason: "user_request",
      });
      client.close();
      client = null;
      state.activeMissionId = null;
      ctx.ui.notify("[Grand Fleet] Admiralty 연결 해제 완료", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    // env var 기반 자동 접속 (formation/auto-subdirs가 기동한 경우)
    if (state.socketPath && state.fleetId) {
      connectToAdmiralty(state.socketPath, state.fleetId, pi, ctx);
    }
  });

  // 임무 진행 중 모든 턴의 텍스트를 누적한다.
  let missionTexts: string[] = [];

  // message_end: 임무 중 매 턴의 텍스트를 누적하고, 최종 턴에서 보고 전송
  pi.on("message_end", async (event) => {
    if (!state.activeMissionId || !client) return;

    const msg: any = event.message;
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return;

    // 현재 턴의 텍스트 추출
    const turnText = msg.content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();

    if (turnText) {
      missionTexts.push(turnText);
    }

    // tool_use 블록이 있으면 중간 턴이므로 누적만 하고 보고하지 않는다.
    const hasToolUse = msg.content.some((c: any) => c?.type === "tool_use");
    if (hasToolUse) return;

    // 최종 턴 — 누적된 전체 텍스트를 보고한다.
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
    missionTexts = [];
  });

  pi.on("session_shutdown", async () => {
    stopHeartbeat();
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
  });
}

/** Admiralty에 접속한다. 이미 연결 중이면 무시. */
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
      await client?.sendRequest("fleet.register", buildFleetRegisterPayload(fleetIdToUse));
      log.info(LOG_SOURCE, "fleet.register 성공");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(LOG_SOURCE, `fleet.register 실패: ${message}`);
      ctx.ui.notify(`[Grand Fleet] 등록 실패: ${message}`, "error");
    }

    startHeartbeat(fleetIdToUse);
  });

  client.onDisconnect(() => {
    log.warn(LOG_SOURCE, "Admiralty 연결 끊김");
    ctx.ui.notify("[Grand Fleet] Admiralty 연결 끊김", "warning");
    stopHeartbeat();
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
      pi.sendUserMessage(objective, { deliverAs: "followUp" });
      return { accepted: true, missionId };
    },
    onMissionAbort: async (params) => {
      log.warn(LOG_SOURCE, `작전 중단 수신: missionId=${String(params.missionId ?? "")}`);
      state.activeMissionId = null;
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
      return { suspended: true, sessionId: "current" };
    },
    onFleetPing: async () => {
      return {
        fleetId: fleetIdToUse,
        fleetStatus: state.activeMissionId ? "active" : "idle",
        activeMissionId: state.activeMissionId,
        uptime: Math.floor(process.uptime()),
        cost: 0,
        carriers: {},
      };
    },
  });

  client.connect();
}

function buildFleetRegisterPayload(fleetId: FleetId): FleetRegisterPayload {
  return {
    fleetId,
    operationalZone: process.cwd(),
    sessionId: `session-${Date.now()}`,
    protocolVersion: PROTOCOL_VERSION,
    carriers: {},
  };
}

function startHeartbeat(fleetId: FleetId): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    getLogAPI().debug(
      LOG_SOURCE,
      `heartbeat 전송: fleetId=${fleetId}`,
      { hideFromFooter: true },
    );
    client?.sendNotification("fleet.heartbeat", {
      fleetId,
      uptime: Math.floor(process.uptime()),
      activeMissionId: getState().activeMissionId,
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
}
