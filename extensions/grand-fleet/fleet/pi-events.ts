import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { PROVIDER_ID, setCliSystemPrompt } from "../../core/agentclientprotocol/provider-types.js";
import { getLogAPI } from "../../core/log/bridge.js";
import { getState } from "../index.js";
import { buildFleetAcpSystemPrompt, buildFleetContextPrompt } from "../prompts.js";
import { sendCompleteReport } from "./reporter.js";
import {
  connectToAdmiralty,
  clearFleetSessionBindings,
  flushFleetStatus,
  getFleetClient,
  getFleetRuntime,
  setFleetSessionBindings,
  shutdownFleetRuntime,
} from "./runtime.js";

const LOG_SOURCE = "grand-fleet";

export function registerFleetPiEvents(pi: ExtensionAPI): void {
  const state = getState();
  const fleetId = state?.fleetId ?? "unset";
  const log = getLogAPI();

  pi.on("before_agent_start", (event) => {
    const client = getFleetClient();
    if (!client || client.getState() !== "connected") return;
    const context = buildFleetContextPrompt(
      fleetId,
      state.designation ?? fleetId,
      process.cwd(),
    );
    return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    setFleetSessionBindings(pi, ctx, {
      setBaseOnly: () => syncAcpSystemPrompt(
        ctx,
        state.fleetId ?? fleetId,
        state.designation ?? fleetId,
        false,
      ),
      setConnected: (connectedFleetId, designation, operationalZone) => syncAcpSystemPrompt(
        ctx,
        connectedFleetId,
        designation,
        true,
        operationalZone,
      ),
    });
    if (state.socketPath && state.fleetId) {
      connectToAdmiralty(state.socketPath, state.fleetId);
    }
    syncAcpSystemPrompt(
      ctx,
      state.fleetId ?? fleetId,
      state.designation ?? fleetId,
      getFleetClient()?.getState() === "connected",
    );
  });

  pi.on("message_end", async (event) => {
    const client = getFleetClient();
    if (!state.activeMissionId || !client) return;

    const msg: any = event.message;
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return;

    const turnText = msg.content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();

    if (turnText) {
      getFleetRuntime().missionTexts.push(turnText);
    }
    flushFleetStatus(state.fleetId ?? fleetId);
  });

  pi.on("agent_end", async (_event) => {
    const runtime = getFleetRuntime();
    const client = getFleetClient();
    if (!state.activeMissionId || !client) return;

    const missionId = state.activeMissionId;
    const summary = runtime.missionTexts.join("\n\n---\n\n");
    if (!summary) return;

    log.info(LOG_SOURCE, `에이전트 루프 종료 (임무 미완료): missionId=${missionId}, complete 보고 전송`);
    sendCompleteReport(client, fleetId, missionId, summary);

    state.activeMissionId = null;
    state.activeMissionObjective = null;
    runtime.missionTexts = [];
    flushFleetStatus(state.fleetId ?? fleetId, true);
  });

  pi.on("session_shutdown", async () => {
    shutdownFleetRuntime(fleetId, {
      resetPrompt: () => setCliSystemPrompt(buildFleetAcpSystemPrompt(
        state.fleetId ?? fleetId,
        state.designation ?? fleetId,
        process.cwd(),
        { includeGrandFleetContext: false },
      )),
    });
    clearFleetSessionBindings();
  });
}

function syncAcpSystemPrompt(
  ctx: ExtensionContext,
  fleetId: string,
  designation: string,
  includeGrandFleetContext: boolean,
  operationalZone = process.cwd(),
): void {
  const isAcp = ctx.model?.provider === PROVIDER_ID;
  if (!isAcp) return;
  setCliSystemPrompt(buildFleetAcpSystemPrompt(
    fleetId,
    designation,
    operationalZone,
    { includeGrandFleetContext },
  ));
}
