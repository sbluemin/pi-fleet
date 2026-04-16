/**
 * fleet/register.ts — Fleet 모드 와이어링
 *
 * Admiralty에 IPC 클라이언트로 접속하고, Grand Fleet Context를
 * 시스템 프롬프트에 append하며, 명령 수신 시 Admiral에 주입한다.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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
  const socketPath = state?.socketPath ?? "unset";
  const log = getLogAPI();

  log.info(LOG_SOURCE, `Fleet 모드 초기화: fleetId=${fleetId}, socket=${socketPath}`);

  if (!state || !state.socketPath || !state.fleetId) {
    log.error(LOG_SOURCE, "필수 환경변수 미설정: PI_FLEET_ID, PI_GRAND_FLEET_SOCK");
    return;
  }

  pi.on("before_agent_start", (event) => {
    const context = buildFleetContextPrompt(fleetId, process.cwd());
    return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    client = new FleetClient(socketPath);

    client.onConnect(async () => {
      log.info(LOG_SOURCE, "Admiralty 접속 완료");
      ctx.ui.notify("[Grand Fleet] Admiralty 접속 완료", "info");

      try {
        log.debug(LOG_SOURCE, "fleet.register 전송");
        await client?.sendRequest("fleet.register", buildFleetRegisterPayload(fleetId));
        log.info(LOG_SOURCE, "fleet.register 성공");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(LOG_SOURCE, `fleet.register 실패: ${message}`);
        ctx.ui.notify(`[Grand Fleet] 등록 실패: ${message}`, "error");
      }

      startHeartbeat(fleetId);
    });

    client.onDisconnect(() => {
      log.warn(LOG_SOURCE, "Admiralty 연결 끊김");
      ctx.ui.notify("[Grand Fleet] Admiralty 연결 끊김 — 재연결 시도 중", "warning");
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
        // TODO: ctx.newSession() 호출
        return { sessionId: `session-${Date.now()}` };
      },
      onSessionResume: async (params) => {
        // TODO: ctx.resumeSession() 호출
        return { resumed: true, sessionId: String(params.sessionId ?? "") };
      },
      onSessionSuspend: async () => {
        state.activeMissionId = null;
        return { suspended: true, sessionId: "current" };
      },
      onFleetPing: async () => {
        return {
          fleetId,
          fleetStatus: state.activeMissionId ? "active" : "idle",
          activeMissionId: state.activeMissionId,
          uptime: Math.floor(process.uptime()),
          cost: 0,
          carriers: {},
        };
      },
    });

    client.connect();
  });

  // message_end: Admiral 응답 완료 시 작전 보고 전송
  pi.on("message_end", async (event) => {
    if (!state.activeMissionId || !client) return;

    const msg: any = event.message;
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return;

    // assistant 응답 텍스트 추출
    const responseText = msg.content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();

    if (!responseText) return;

    const missionId = state.activeMissionId;
    log.info(LOG_SOURCE, `작전 보고 전송: missionId=${missionId}, 응답 ${responseText.length}자`);

    client.sendNotification("mission.report", {
      fleetId,
      missionId,
      type: "complete",
      summary: responseText.slice(0, 2000),
      timestamp: new Date().toISOString(),
    });

    state.activeMissionId = null;
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
