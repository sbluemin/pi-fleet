export type {
  ArchiveBlock,
  CarrierJobLaunchResponse,
  CarrierJobSummary,
  JobArchive,
} from "../job/job-types.js";

export interface CompletionPushPayload {
  readonly jobId: string;
  readonly carrierId: string;
  readonly title: string;
  readonly content: string;
  readonly details?: unknown;
}
