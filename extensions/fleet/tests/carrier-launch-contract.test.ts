import { describe, expect, it, vi } from "vitest";

import { acquireJobPermit, resetJobConcurrencyForTest } from "../shipyard/_shared/concurrency-guard.js";
import { formatLaunchResponseText } from "../shipyard/_shared/job-reminders.js";
import type { CarrierJobLaunchResponse, CarrierJobRecord, CarrierJobStatus } from "../shipyard/_shared/job-types.js";

describe("carrier launch contract", () => {
  it("launch responses contain job_id and accepted but no synchronous payload fields", () => {
    const response: CarrierJobLaunchResponse = {
      job_id: "sortie:call-1",
      accepted: true,
    };

    expect(response).toMatchObject({ job_id: "sortie:call-1", accepted: true });
    expect(response).not.toHaveProperty("content");
    expect(response).not.toHaveProperty("summary");
    expect(response).not.toHaveProperty("full_result");
  });

  it("global cap and same-carrier busy rejections are independent", () => {
    resetJobConcurrencyForTest();
    const first = acquireJobPermit(buildRecord("sortie:first", ["genesis"]));
    expect(first.accepted).toBe(true);

    expect(acquireJobPermit(buildRecord("sortie:busy", ["genesis"]))).toEqual({
      accepted: false,
      error: "carrier busy",
      current_job_id: "sortie:first",
    });

    for (let i = 0; i < 4; i++) {
      expect(acquireJobPermit(buildRecord(`sortie:${i}`, [`carrier-${i}`])).accepted).toBe(true);
    }
    expect(acquireJobPermit(buildRecord("sortie:cap", ["carrier-cap"]))).toEqual({
      accepted: false,
      error: "concurrency limit",
    });
  });

  it("prioritizes aborted over error and done for detached final status", () => {
    expect(computeFinalStatus([{ status: "done" }, { status: "aborted" }, { status: "error" }])).toBe("aborted");
    expect(computeFinalStatus([{ status: "done" }, { status: "error" }])).toBe("error");
    expect(computeFinalStatus([{ status: "done" }])).toBe("done");
  });

  it("uses aborted wording without completed wording for detached summaries", () => {
    for (const tool of ["carriers_sortie", "carrier_squadron", "carrier_taskforce"]) {
      const summary = buildSummaryText(tool, "aborted", 1, 1);
      expect(summary).toContain("aborted");
      expect(summary).not.toContain("completed");
    }
  });

  it("does not schedule detached onUpdate polling timers", () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();

    launchDetachedWithoutOnUpdate(onUpdate);
    vi.advanceTimersByTime(1000);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("adds launch guidance only for accepted background jobs", () => {
    const accepted = formatLaunchResponseText({ job_id: "sortie:call-1", accepted: true }, true);
    expect(accepted).toMatch(/^<system-reminder>/);
    expect(accepted).toContain("background execution");
    expect(accepted).toContain("follow-up push");
    expect(accepted).toContain("Do not poll, wait-check, or call carrier_jobs merely to see whether the job is done");
    expect(accepted).toContain("stop tool use and wait passively for the [carrier:result] follow-up push");
    expect(accepted).toContain('{"job_id":"sortie:call-1","accepted":true}');

    const rejected = formatLaunchResponseText({ job_id: "sortie:call-1", accepted: false, error: "carrier busy" }, false);
    expect(rejected).toBe('{"job_id":"sortie:call-1","accepted":false,"error":"carrier busy"}');
    expect(rejected).not.toContain("<system-reminder>");
  });
});

function computeFinalStatus(results: Array<{ status: "done" | "error" | "aborted" }>): CarrierJobStatus {
  if (results.some((result) => result.status === "aborted")) return "aborted";
  if (results.some((result) => result.status === "error")) return "error";
  return "done";
}

function buildSummaryText(tool: string, status: CarrierJobStatus, successCount: number, failureCount: number, error?: string): string {
  if (status === "aborted") return `${tool} aborted: ${successCount} done, ${failureCount} failed`;
  if (error) return `${tool} failed: ${error}`;
  return `${tool} completed: ${successCount} done, ${failureCount} failed`;
}

function launchDetachedWithoutOnUpdate(_onUpdate: () => void): CarrierJobLaunchResponse {
  return {
    job_id: "sortie:call-1",
    accepted: true,
  };
}

function buildRecord(jobId: string, carriers: string[]): CarrierJobRecord {
  return {
    jobId,
    tool: "carriers_sortie",
    status: "active",
    startedAt: 1000,
    carriers,
  };
}
