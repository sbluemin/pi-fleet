export type CarrierJobStatus = "active" | "done" | "error" | "aborted";

export type ArchiveBlockKind = "text" | "thought" | "tool_call";

export interface ArchiveBlock {
  kind: ArchiveBlockKind;
  timestamp: number;
  source: string;
  label?: string;
  text?: string;
  title?: string;
  status?: string;
  rawOutput?: string;
  toolCallId?: string;
}

export interface JobArchive {
  jobId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  finalizedAt?: number;
  status: CarrierJobStatus;
  truncated: boolean;
  totalBytes: number;
  blocks: ArchiveBlock[];
}

export interface CarrierJobSummary {
  jobId: string;
  tool: "carriers_sortie" | "carrier_squadron" | "carrier_taskforce";
  status: CarrierJobStatus;
  summary: string;
  startedAt: number;
  finishedAt?: number;
  carriers: string[];
  error?: string;
}

export interface CarrierJobRecord {
  jobId: string;
  tool: CarrierJobSummary["tool"];
  status: CarrierJobStatus;
  startedAt: number;
  finishedAt?: number;
  carriers: string[];
  error?: string;
}

export interface CarrierJobLaunchResponse {
  job_id: string;
  accepted: boolean;
  error?: string;
  current_job_id?: string;
}

export interface CompletionPushItem {
  jobId: string;
  summary: string;
}

export const CARRIER_JOB_TTL_MS = 3 * 60 * 60 * 1000;
