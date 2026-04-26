import { Type, type TObject } from "@sinclair/typebox";

import type { ToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import {
  deriveToolDescription,
  deriveToolPromptGuidelines,
  deriveToolPromptSnippet,
} from "../../admiral/tool-prompt-manifest/index.js";

export const CARRIER_JOBS_MANIFEST: ToolPromptManifest = {
  id: "carrier_jobs",
  tag: "carrier_jobs",
  title: "carrier_jobs Tool Guidelines",
  description:
    `Lookup and control detached carrier jobs registered by carriers_sortie, carrier_squadron, and carrier_taskforce.` +
    ` This is not a delegation tool and not a polling tool; use it only to inspect summaries, read full archived output once, cancel by job_id, or list jobs.`,
  promptSnippet:
    `carrier_jobs — Lookup/control detached carrier jobs: status, result, cancel, list.`,
  whenToUse: [
    `Use carrier_jobs when a follow-up push is missing, explicit job inspection is required, or the Admiral needs completion metadata, summary, full archived output, cancellation, or a job list.`,
    `Use action:"result" with format:"summary" for repeatable summaries. Use format:"full" only after the job is finalized and only once when raw chronological output is needed.`,
  ],
  whenNotToUse: [
    `Do not use carrier_jobs to delegate new work; use carriers_sortie, carrier_squadron, or carrier_taskforce.`,
    `Do not expect full results to be reusable. Full archive reads are finalized-only, read-once, and invalidate immediately.`,
    `Do not poll, wait-check, or call carrier_jobs merely to see whether a launched job is done; terminal results arrive through the [carrier:result] follow-up push.`,
  ],
  usageGuidelines: [
    `carrier_jobs has exactly four actions: status, result, cancel, list.`,
    `After launch, continue independent work if available; otherwise stop tool use and wait passively for the follow-up push instead of issuing status probes.`,
    `Treat carrier_jobs as the fallback channel for missing pushes or explicit lookups, not as a polling loop.`,
    `Summary results are read-many and expire after 3h in process memory.`,
    `Full results are finalized-only, read-once, expire after 3h in process memory, and are returned only when format:"full" is explicitly requested.`,
    `carrier_jobs reads the process-memory summary cache and JobStreamArchive only. It never reads the Agent Panel stream-store.`,
  ],
};

export const CARRIER_JOBS_DESCRIPTION = deriveToolDescription(CARRIER_JOBS_MANIFEST);

export function buildCarrierJobsPromptSnippet(): string {
  return deriveToolPromptSnippet(CARRIER_JOBS_MANIFEST);
}

export function buildCarrierJobsPromptGuidelines(): string[] {
  return deriveToolPromptGuidelines(CARRIER_JOBS_MANIFEST);
}

export function buildCarrierJobsSchema(): TObject {
  return Type.Object({
    action: Type.Unsafe<string>({
      type: "string",
      enum: ["status", "result", "cancel", "list"],
      description: "Job action to perform.",
    }),
    job_id: Type.Optional(Type.String({
      description: "Required for status, result, and cancel. Must be a prefixed job ID such as sortie:<toolCallId>.",
    })),
    format: Type.Optional(Type.Unsafe<string>({
      type: "string",
      enum: ["summary", "full"],
      description: "Only used with action=result. Defaults to summary. Full is read-once.",
    })),
  });
}
