import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "../../compat/pi-ai-bridge.js";
import { Type } from "@sinclair/typebox";

import { getLogAPI } from "../../core/log/bridge.js";
import { getState } from "../index.js";
import { type ReportType } from "../types.js";
import { sendMissionReport } from "./reporter.js";
import { flushFleetStatus, getFleetClient, getFleetRuntime } from "./runtime.js";

const LOG_SOURCE = "grand-fleet";

export function registerFleetPiTools(pi: ExtensionAPI): void {
  const state = getState();
  const fleetId = state?.fleetId ?? "unset";
  const log = getLogAPI();

  pi.registerTool({
    name: "mission_report",
    label: "Mission Report",
    description: "작전 보고를 Admiralty에 전송한다. 임무 완료/실패/차단 시 반드시 호출해야 한다.",
    parameters: Type.Object({
      type: StringEnum(["complete", "failed", "blocked"]) as any,
      summary: Type.String({ description: "작전 결과 요약" }),
    }) as any,
    async execute(
      _toolCallId: string,
      params: any,
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      _ctx: ExtensionContext,
    ) {
      const client = getFleetClient();
      if (!state.activeMissionId || !client) {
        throw new Error("활성 임무가 없거나 Admiralty에 연결되지 않았습니다.");
      }

      const runtime = getFleetRuntime();
      const missionId = state.activeMissionId;
      const reportParams = params as { type: ReportType; summary: string };
      const reportType = reportParams.type;
      const accumulated = runtime.missionTexts.join("\n\n---\n\n");
      const fullSummary = accumulated
        ? `${accumulated}\n\n---\n\n${reportParams.summary}`
        : reportParams.summary;

      sendMissionReport(client, {
        fleetId,
        missionId,
        type: reportType,
        summary: fullSummary,
      });

      log.info(LOG_SOURCE, `작전 보고 전송 (tool): type=${reportType}, missionId=${missionId}`);

      state.activeMissionId = null;
      state.activeMissionObjective = null;
      runtime.missionTexts = [];
      flushFleetStatus(state.fleetId ?? fleetId, true);

      return {
        content: [{ type: "text" as const, text: `작전 보고 완료: ${reportType}` }],
      };
    },
  } as any);
}
