import type { CarrierJobStatus, CarrierJobSummary } from "../../services/job/index.js";
import { SQUADRON_MAX_INSTANCES, type SquadronResult } from "./types.js";

export interface SquadronSubtaskInput {
  readonly title: string;
  readonly request: string;
}

export function validateSquadronSubtaskCount(expected: number, actual: number): void {
  if (expected !== actual) {
    throw new Error(
      `expected_subtask_count (${expected}) does not match subtasks array length (${actual}).` +
      ` These must be equal.`,
    );
  }
}

export function validateSquadronSubtaskLimit(count: number): void {
  if (count < 1) {
    throw new Error("At least 1 subtask is required.");
  }
  if (count > SQUADRON_MAX_INSTANCES) {
    throw new Error(`Too many subtasks: ${count} exceeds maximum of ${SQUADRON_MAX_INSTANCES}.`);
  }
}

export function sanitizeSquadronSubtasks(
  subtasks: readonly SquadronSubtaskInput[],
): SquadronSubtaskInput[] {
  return subtasks.map((subtask) => ({
    title: sanitizeSquadronTitle(subtask.title),
    request: subtask.request,
  }));
}

export function sanitizeSquadronTitle(text: string): string {
  return text
    .replace(/[\r\n]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/<<<|>>>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "(untitled)";
}

export function buildSquadronRequestKey(
  carrierId: string,
  subtasks: readonly SquadronSubtaskInput[],
): string {
  return JSON.stringify([carrierId, subtasks.map((subtask) => [subtask.title, subtask.request])]);
}

export function buildSquadronRunId(requestKey: string, index: number): string {
  const encodedKey = Buffer.from(requestKey, "utf-8").toString("base64url");
  return `squadron:${encodedKey}:${index}`;
}

export function computeSquadronFinalStatus(results: readonly SquadronResult[]): CarrierJobStatus {
  if (results.some((result) => result.status === "aborted")) return "aborted";
  if (results.some((result) => result.status === "error")) return "error";
  return "done";
}

export function buildSquadronSummaryText(
  status: CarrierJobStatus,
  successCount: number,
  failureCount: number,
  error?: string,
): string {
  if (status === "aborted") return `carrier_squadron aborted: ${successCount} done, ${failureCount} failed`;
  if (error) return `carrier_squadron failed: ${error}`;
  return `carrier_squadron completed: ${successCount} done, ${failureCount} failed`;
}

export function buildSquadronJobSummary(
  jobId: string,
  startedAt: number,
  finishedAt: number,
  carrierId: string,
  results: readonly SquadronResult[],
  status: CarrierJobStatus,
  error?: string,
): CarrierJobSummary {
  const successCount = results.filter((result) => result.status === "done").length;
  const failureCount = results.length - successCount;
  return {
    jobId,
    tool: "carrier_squadron",
    status,
    summary: buildSquadronSummaryText(status, successCount, failureCount, error),
    startedAt,
    finishedAt,
    carriers: [carrierId],
    error,
  };
}
