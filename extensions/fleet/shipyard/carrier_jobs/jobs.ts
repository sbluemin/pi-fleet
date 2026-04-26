import { registerToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import { cancelJob } from "../_shared/job-cancel-registry.js";
import { getActiveJob, listActiveJobs } from "../_shared/concurrency-guard.js";
import { getAndInvalidate, hasFinalizedJobArchive, hasJobArchive } from "../_shared/job-stream-archive.js";
import { isCarrierJobId } from "../_shared/job-id.js";
import { wrapSystemReminder } from "../_shared/job-reminders.js";
import type { CarrierJobRecord, CarrierJobSummary } from "../_shared/job-types.js";
import { serializeJobArchive } from "../_shared/archive-serializer.js";
import { getJobSummary, listJobSummaries } from "../_shared/lru-cache.js";
import {
  CARRIER_JOBS_DESCRIPTION,
  CARRIER_JOBS_MANIFEST,
  buildCarrierJobsPromptGuidelines,
  buildCarrierJobsPromptSnippet,
  buildCarrierJobsSchema,
} from "./prompts.js";
import type { CarrierJobsAvailability, CarrierJobsParams } from "./types.js";
import { CarrierJobsCallComponent, CarrierJobsVerboseCallComponent, renderQuietResult, renderVerboseResult } from "./render.js";
import { getCarrierJobsVerbose } from "./verbose-toggle.js";

interface CarrierJobsResponse {
  action: string;
  job_id?: string;
  ok: boolean;
  status?: string;
  active?: CarrierJobRecord[];
  recent?: CarrierJobSummary[];
  summary?: CarrierJobSummary;
  full_result?: string;
  full_available?: boolean;
  full_invalidated?: boolean;
  retry_after?: string;
  notice?: string;
  summary_available?: boolean;
  cancelled?: boolean;
  error?: string;
}

const ACTIVE_STATUS_NOTICE =
  "Job is still running. The [carrier:result] push will be delivered automatically when it finishes — do not call carrier_jobs again until that push arrives. Stop calling tools now and return control to the user; the push wakes the agent even after this response ends.";
const ACTIVE_CANCEL_NOTICE =
  "Cancel did not apply: the job is still running normally, not hung. Long-running carrier jobs are expected — do not retry cancel without an explicit user request to abort. The [carrier:result] push will arrive automatically; stop calling tools and return control to the user.";

export function buildCarrierJobsToolConfig() {
  registerToolPromptManifest(CARRIER_JOBS_MANIFEST);

  return {
    name: "carrier_jobs",
    label: "Carrier Jobs",
    description: CARRIER_JOBS_DESCRIPTION,
    promptSnippet: buildCarrierJobsPromptSnippet(),
    promptGuidelines: buildCarrierJobsPromptGuidelines(),
    parameters: buildCarrierJobsSchema(),
    renderCall(args: unknown, _theme: unknown, context: any) {
      const typedArgs = args as CarrierJobsParams;
      if (getCarrierJobsVerbose()) {
        const component = context?.lastComponent instanceof CarrierJobsVerboseCallComponent
          ? context.lastComponent
          : new CarrierJobsVerboseCallComponent();
        component.setState(typedArgs);
        return component;
      }
      const component = context?.lastComponent instanceof CarrierJobsCallComponent
        ? context.lastComponent
        : new CarrierJobsCallComponent();
      component.setState(typedArgs);
      return component;
    },
    renderResult(result: any) {
      return getCarrierJobsVerbose() ? renderVerboseResult(result) : renderQuietResult(result);
    },
    async execute(
      _id: string,
      params: Record<string, unknown>,
    ) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(dispatchCarrierJobsAction(params as unknown as CarrierJobsParams), null, 2) }],
        details: {},
      };
    },
  };
}

export function dispatchCarrierJobsAction(params: CarrierJobsParams, now = Date.now()): CarrierJobsResponse {
  if (params.action === "list") {
    return {
      action: "list",
      ok: true,
      active: listActiveJobs(),
      recent: listJobSummaries(now),
    };
  }

  const jobIdError = validateJobId(params.job_id);
  if (jobIdError) {
    return {
      action: params.action,
      job_id: params.job_id,
      ok: false,
      error: jobIdError,
    };
  }

  const jobId = params.job_id!;
  if (params.action === "status") return statusResponse(jobId, now);
  if (params.action === "result") return resultResponse(jobId, params.format ?? "summary", now);
  if (params.action === "cancel") return cancelResponse(jobId, now);

  return {
    action: String((params as { action?: unknown }).action),
    job_id: jobId,
    ok: false,
    error: "unsupported action",
  };
}

function statusResponse(jobId: string, now: number): CarrierJobsResponse {
  const active = getActiveJob(jobId);
  const summary = getJobSummary(jobId, now);
  const availability = getAvailability(jobId, summary, now);
  return {
    action: "status",
    job_id: jobId,
    ok: Boolean(active || summary || availability.full_available),
    status: active?.status ?? summary?.status ?? "not_found",
    summary: summary ?? undefined,
    notice: active ? wrapSystemReminder(ACTIVE_STATUS_NOTICE) : undefined,
    ...availability,
  };
}

function resultResponse(jobId: string, format: string, now: number): CarrierJobsResponse {
  if (format === "full") {
    const active = getActiveJob(jobId);
    if (active) {
      return {
        action: "result",
        job_id: jobId,
        ok: false,
        status: active.status,
        full_available: false,
        full_invalidated: false,
        error: "job not finalized",
        retry_after:
          "do not retry; wait for the [carrier:result] push that will arrive automatically when the job reaches done, error, or aborted.",
        notice: wrapSystemReminder(ACTIVE_STATUS_NOTICE),
      };
    }
    const archive = getAndInvalidate(jobId, now);
    const summary = getJobSummary(jobId, now);
    return {
      action: "result",
      job_id: jobId,
      ok: Boolean(archive),
      summary: summary ?? undefined,
      full_result: archive ? serializeJobArchive(archive) : undefined,
      summary_available: Boolean(summary),
      full_available: false,
      full_invalidated: !archive,
      error: archive ? undefined : "full result unavailable or already invalidated",
    };
  }

  const summary = getJobSummary(jobId, now);
  return {
    action: "result",
    job_id: jobId,
    ok: Boolean(summary),
    summary: summary ?? undefined,
    notice: summary?.status === "active" ? wrapSystemReminder(ACTIVE_STATUS_NOTICE) : undefined,
    ...getAvailability(jobId, summary, now),
    error: summary ? undefined : "summary unavailable",
  };
}

function cancelResponse(jobId: string, now: number): CarrierJobsResponse {
  const result = cancelJob(jobId);
  const active = getActiveJob(jobId);
  const summary = getJobSummary(jobId, now);
  return {
    action: "cancel",
    job_id: jobId,
    ok: result.cancelled,
    cancelled: result.cancelled,
    status: result.cancelled ? "cancelled" : active?.status ?? summary?.status ?? "not_found",
    summary: summary ?? undefined,
    notice: !result.cancelled && active ? wrapSystemReminder(ACTIVE_CANCEL_NOTICE) : undefined,
    ...getAvailability(jobId, summary, now),
    error: result.cancelled ? undefined : "job not found or already finished",
  };
}

function getAvailability(jobId: string, summary: CarrierJobSummary | null, now: number): CarrierJobsAvailability {
  const fullAvailable = hasFinalizedJobArchive(jobId, now);
  return {
    summary_available: Boolean(summary),
    full_available: fullAvailable,
    full_invalidated: !hasJobArchive(jobId, now) && Boolean(summary),
  };
}

function validateJobId(jobId: string | undefined): string | null {
  if (!jobId) return "job_id is required";
  if (!isCarrierJobId(jobId)) return "job_id must start with sortie:, squadron:, or taskforce:";
  return null;
}
