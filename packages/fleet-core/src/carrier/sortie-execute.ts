import type { CarrierJobLaunchResponse, CarrierJobStatus, CarrierJobSummary } from "../job/index.js";
import type { CarrierAssignment } from "./prompts.js";

export interface CarrierSortieOutcome {
  readonly carrierId: string;
  readonly status: "done" | "error" | "aborted";
}

export interface ValidateSortieAssignmentsOptions {
  readonly expectedCount: number;
  readonly assignments: readonly CarrierAssignment[] | undefined;
  readonly registeredIds: readonly string[];
  readonly enabledIds: readonly string[];
  resolveUnavailableReason(carrierId: string): string;
  readonly jobId: string;
}

export interface SortieValidationResult {
  readonly assignments: readonly CarrierAssignment[];
  readonly rejection?: CarrierJobLaunchResponse;
}

export function validateSortieAssignments(options: ValidateSortieAssignmentsOptions): SortieValidationResult {
  const assignments = options.assignments;
  if (!assignments || assignments.length < 1) {
    throw new Error("carriers_sortie requires at least 1 carrier assignment.");
  }

  if (options.expectedCount !== assignments.length) {
    throw new Error(
      `Carrier count mismatch: expected_carrier_count is ${options.expectedCount} but carriers array has ${assignments.length} entr${assignments.length === 1 ? "y" : "ies"}.` +
      ` Add all ${options.expectedCount} carrier${options.expectedCount === 1 ? "" : "s"} to the carriers array and resubmit as a single call.`,
    );
  }

  const registeredIds = new Set(options.registeredIds);
  const enabledIds = new Set(options.enabledIds);
  const seen = new Set<string>();
  for (const assignment of assignments) {
    if (!registeredIds.has(assignment.carrier)) {
      const registered = [...registeredIds].join(", ") || "(none)";
      throw new Error(`Unknown carrier: "${assignment.carrier}". Registered carriers: ${registered}`);
    }

    if (!enabledIds.has(assignment.carrier)) {
      const available = [...enabledIds].join(", ") || "(none)";
      const reason = options.resolveUnavailableReason(assignment.carrier);
      return {
        assignments,
        rejection: {
          job_id: options.jobId,
          accepted: false,
          error: `Carrier "${assignment.carrier}" is not available for sortie: ${reason}. Available carriers: ${available}`,
        },
      };
    }

    if (seen.has(assignment.carrier)) {
      throw new Error(`Duplicate carrier: "${assignment.carrier}". Each carrier can only be assigned once.`);
    }
    seen.add(assignment.carrier);
  }

  return { assignments };
}

export function computeSortieFinalStatus(results: readonly CarrierSortieOutcome[]): CarrierJobStatus {
  if (results.some((result) => result.status === "aborted")) return "aborted";
  if (results.some((result) => result.status === "error")) return "error";
  return "done";
}

export function buildSortieSummaryText(
  status: CarrierJobStatus,
  successCount: number,
  failureCount: number,
  error?: string,
): string {
  if (status === "aborted") return `carriers_sortie aborted: ${successCount} done, ${failureCount} failed`;
  if (error) return `carriers_sortie failed: ${error}`;
  return `carriers_sortie completed: ${successCount} done, ${failureCount} failed`;
}

export function buildSortieJobSummary(
  jobId: string,
  startedAt: number,
  finishedAt: number,
  assignments: readonly CarrierAssignment[],
  results: readonly CarrierSortieOutcome[],
  status: CarrierJobStatus,
  error?: string,
): CarrierJobSummary {
  const successCount = results.filter((result) => result.status === "done").length;
  const failureCount = results.length - successCount;
  return {
    jobId,
    tool: "carriers_sortie",
    status,
    summary: buildSortieSummaryText(status, successCount, failureCount, error),
    startedAt,
    finishedAt,
    carriers: assignments.map((assignment) => assignment.carrier),
    error,
  };
}
