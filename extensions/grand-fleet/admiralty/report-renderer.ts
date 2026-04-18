/**
 * admiralty/report-renderer.ts — 함대 보고서 TUI 렌더링
 *
 * mission.report 수신 시 Admiralty LLM이 후속 정리를 하도록 보고서를 주입한다.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getLogAPI } from "../../core/log/bridge.js";
import type { FleetId, ReportType } from "../types.js";

interface ReportParams {
  fleetId: FleetId;
  missionId: string;
  type: ReportType;
  summary: string;
  phases?: { executed: number[]; skipped: Record<string, string> };
  fileStats?: { modified: number; created: number; deleted: number };
  openIssues?: string[];
  timestamp: string;
}

const STATUS_ICONS: Record<ReportType, string> = {
  progress: "⏳ 진행중",
  complete: "✅ 완료",
  failed: "❌ 실패",
  blocked: "⚠️ 차단",
};
const LOG_SOURCE = "grand-fleet:admiralty";

/** 보고서를 Admiralty LLM에 후속 사용자 메시지로 주입한다 */
export function renderReport(
  pi: ExtensionAPI,
  params: Record<string, unknown>,
): void {
  const report = params as unknown as ReportParams;
  getLogAPI().debug(
    LOG_SOURCE,
    `보고서 수신: Fleet ${report.fleetId}, type=${report.type}`,
  );
  const icon = STATUS_ICONS[report.type] ?? report.type;
  const time = report.timestamp
    ? new Date(report.timestamp).toLocaleTimeString()
    : "";

  // Admiralty LLM이 보고를 수신하여 정리하도록 후속 사용자 메시지로 전달한다.
  let content = `[Fleet ${report.fleetId} 작전 보고 수신 (${time})]\n`;
  content += `Status: ${icon}\n`;
  content += `\n${report.summary}\n`;

  if (report.phases) {
    content += `\nPhases: ${report.phases.executed.join(" → ")}\n`;
  }
  if (report.fileStats) {
    const { modified, created, deleted } = report.fileStats;
    content += `Files: 변경 ${modified} | 신규 ${created} | 삭제 ${deleted}\n`;
  }
  if (report.openIssues && report.openIssues.length > 0) {
    content += `미해결: ${report.openIssues.join(", ")}\n`;
  }

  pi.sendUserMessage(content, { deliverAs: "followUp" });
}

/** 함대 연결/해제 이벤트 알림 */
export function renderFleetEvent(
  pi: ExtensionAPI,
  fleetId: FleetId,
  event: "connected" | "disconnected",
): void {
  getLogAPI().debug(LOG_SOURCE, `이벤트 렌더링: Fleet ${fleetId}, ${event}`);
  const isConnect = event === "connected";
  const color = isConnect ? "\x1b[38;2;80;220;120m" : "\x1b[38;2;255;100;90m";
  const reset = "\x1b[0m";
  const icon = isConnect ? "⚓" : "✖";
  const label = isConnect ? "접속" : "해제";

  pi.sendMessage({
    customType: "grand-fleet-event",
    content: `${color}${icon}${reset} Fleet ${fleetId} ${color}${label}${reset}`,
    display: true,
  });
}
