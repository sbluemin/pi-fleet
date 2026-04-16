/**
 * admiralty/report-renderer.ts — 함대 보고서 TUI 렌더링
 *
 * mission.report 수신 시 pi.sendMessage()로 구조화된 보고서를 TUI에 표시한다.
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

/** 보고서를 TUI 메시지로 렌더링 */
export function renderReport(
  pi: ExtensionAPI,
  params: Record<string, unknown>,
): void {
  const report = params as unknown as ReportParams;
  getLogAPI().debug(
    LOG_SOURCE,
    `보고서 렌더링: Fleet ${report.fleetId}, type=${report.type}`,
  );
  const icon = STATUS_ICONS[report.type] ?? report.type;
  const time = report.timestamp
    ? new Date(report.timestamp).toLocaleTimeString()
    : "";

  let content = `┌─ Fleet ${report.fleetId} 보고 (${time}) ─────\n`;
  content += `│ Status: ${icon}\n`;
  content += `│ ${report.summary}\n`;

  if (report.phases) {
    content += `│ Phases: ${report.phases.executed.join(" → ")}\n`;
  }
  if (report.fileStats) {
    const { modified, created, deleted } = report.fileStats;
    content += `│ Files: 변경 ${modified} | 신규 ${created} | 삭제 ${deleted}\n`;
  }
  if (report.openIssues && report.openIssues.length > 0) {
    content += `│ 미해결: ${report.openIssues.join(", ")}\n`;
  }

  content += "└──────────────────────────────────────";

  pi.sendMessage({
    customType: "grand-fleet-report",
    content,
    display: true,
  });
}

/** 함대 연결/해제 이벤트 알림 */
export function renderFleetEvent(
  pi: ExtensionAPI,
  fleetId: FleetId,
  event: "connected" | "disconnected",
): void {
  getLogAPI().debug(LOG_SOURCE, `이벤트 렌더링: Fleet ${fleetId}, ${event}`);
  const icon = event === "connected" ? "⚓" : "🟥";

  pi.sendMessage({
    customType: "grand-fleet-event",
    content: `${icon} Fleet ${fleetId} — ${
      event === "connected" ? "접속 완료" : "연결 끊김"
    }`,
    display: true,
  });
}
