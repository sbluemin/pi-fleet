/**
 * fleet/reporter.ts — 작전 보고 모듈
 *
 * 작전 결과를 구조화하여 Admiralty에 mission.report를 전송한다.
 */
import { getLogAPI } from "../../core/log/bridge.js";
import type { FleetClient } from "../ipc/client.js";
import type {
  FileStats,
  FleetId,
  MissionId,
  PhaseRecord,
  ReportType,
} from "../types.js";

export interface MissionReportData {
  fleetId: FleetId;
  missionId: MissionId;
  type: ReportType;
  summary: string;
  phases?: PhaseRecord;
  fileStats?: FileStats;
  openIssues?: string[];
}

const LOG_SOURCE = "grand-fleet:fleet";

/** 작전 보고 전송 */
export function sendMissionReport(
  client: FleetClient,
  report: MissionReportData,
): void {
  getLogAPI().info(
    LOG_SOURCE,
    `보고 전송: ${report.type} (missionId=${report.missionId})`,
  );
  client.sendNotification("mission.report", {
    fleetId: report.fleetId,
    missionId: report.missionId,
    type: report.type,
    summary: report.summary,
    phases: report.phases,
    fileStats: report.fileStats,
    openIssues: report.openIssues ?? [],
    timestamp: new Date().toISOString(),
  });
}

/** 진행 보고 (중간 마일스톤) */
export function sendProgressReport(
  client: FleetClient,
  fleetId: FleetId,
  missionId: MissionId,
  summary: string,
): void {
  sendMissionReport(client, {
    fleetId,
    missionId,
    type: "progress",
    summary,
  });
}

/** 완료 보고 */
export function sendCompleteReport(
  client: FleetClient,
  fleetId: FleetId,
  missionId: MissionId,
  summary: string,
  phases?: PhaseRecord,
  fileStats?: FileStats,
): void {
  sendMissionReport(client, {
    fleetId,
    missionId,
    type: "complete",
    summary,
    phases,
    fileStats,
  });
}

/** 실패 보고 */
export function sendFailedReport(
  client: FleetClient,
  fleetId: FleetId,
  missionId: MissionId,
  summary: string,
  openIssues?: string[],
): void {
  sendMissionReport(client, {
    fleetId,
    missionId,
    type: "failed",
    summary,
    openIssues,
  });
}
