/**
 * fleet/panel/jobs.ts — PanelJob 등록/종결 API
 *
 * Agent Panel의 잡 단위 칼럼 트랙 상태를 관리합니다.
 * stream-store와 JobStreamArchive는 건드리지 않고 UI 상태만 보유합니다.
 */

import type { ColStatus } from "../../../services/agent/shared/types.js";
import type { PanelJobKind, PanelJobStatus } from "../run-stream/types.js";
import { getPanelJobs, getState, PANEL_JOB_RETENTION } from "./state.js";
import type { ColumnTrack, PanelJob } from "./types.js";

interface ColumnTrackInput {
  trackId: string;
  streamKey: string;
  displayCli: string;
  runId?: string;
  displayName: string;
  subtitle?: string;
  kind: ColumnTrack["kind"];
}

interface RegisterPanelJobInput {
  jobId: string;
  kind: PanelJobKind;
  ownerCarrierId: string;
  label: string;
  activeJobToolCallId?: string;
  tracks: ColumnTrackInput[];
}

export function registerSortieJob(
  jobId: string,
  ownerCarrierId: string,
  label: string,
  tracks: ColumnTrackInput[],
  activeJobToolCallId?: string,
): PanelJob {
  return registerPanelJob({
    jobId,
    kind: "sortie",
    ownerCarrierId,
    label,
    activeJobToolCallId,
    tracks,
  });
}

export function registerSquadronJob(
  jobId: string,
  ownerCarrierId: string,
  label: string,
  tracks: ColumnTrackInput[],
  activeJobToolCallId?: string,
): PanelJob {
  return registerPanelJob({
    jobId,
    kind: "squadron",
    ownerCarrierId,
    label,
    activeJobToolCallId,
    tracks,
  });
}

export function registerTaskforceJob(
  jobId: string,
  ownerCarrierId: string,
  label: string,
  tracks: ColumnTrackInput[],
  activeJobToolCallId?: string,
): PanelJob {
  return registerPanelJob({
    jobId,
    kind: "taskforce",
    ownerCarrierId,
    label,
    activeJobToolCallId,
    tracks,
  });
}

export function updateColumnTrackStatus(jobId: string, trackId: string, status: ColStatus): void {
  const job = getPanelJobs().get(jobId);
  if (!job) return;
  const track = job.tracks.find((item) => item.trackId === trackId);
  if (!track) return;
  track.status = status;
}

export function updateColumnTrackRunId(jobId: string, trackId: string, runId: string): void {
  const job = getPanelJobs().get(jobId);
  if (!job) return;
  const track = job.tracks.find((item) => item.trackId === trackId);
  if (!track || track.runId) return;
  track.runId = runId;
  if (track.status === "wait") {
    track.status = "conn";
  }
}

export function finalizeJob(jobId: string, status: PanelJobStatus): void {
  const jobs = getPanelJobs();
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.finishedAt = Date.now();
  trimFinalizedJobs();
}

export function getActiveJobs(): PanelJob[] {
  return Array.from(getPanelJobs().values())
    .filter((job) => job.status === "active")
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function getJob(jobId: string): PanelJob | undefined {
  return getPanelJobs().get(jobId);
}

function registerPanelJob(input: RegisterPanelJobInput): PanelJob {
  const state = getState();
  const job: PanelJob = {
    jobId: input.jobId,
    kind: input.kind,
    ownerCarrierId: input.ownerCarrierId,
    label: input.label,
    startedAt: Date.now(),
    status: "active",
    activeJobToolCallId: input.activeJobToolCallId,
    tracks: input.tracks.map(toColumnTrack),
  };
  state.panelJobs.set(job.jobId, job);
  return job;
}

function toColumnTrack(input: ColumnTrackInput): ColumnTrack {
  return {
    trackId: input.trackId,
    streamKey: input.streamKey,
    displayCli: input.displayCli,
    runId: input.runId,
    displayName: input.displayName,
    subtitle: input.subtitle,
    kind: input.kind,
    status: "wait",
  };
}

function trimFinalizedJobs(): void {
  const jobs = getPanelJobs();
  const finalized = Array.from(jobs.values())
    .filter((job) => job.status !== "active" && job.finishedAt)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  for (const job of finalized.slice(PANEL_JOB_RETENTION)) {
    jobs.delete(job.jobId);
  }
}
