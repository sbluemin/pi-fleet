import { executeOneShot } from "./agent-runtime.js";
import {
  appendTextBlock,
  appendThoughtBlock,
  createRun,
  finalizeRun,
  getVisibleRun,
  updateRunStatus,
  upsertToolBlock,
} from "../bridge/run-stream/index.js";
import {
  acquireJobPermit,
  appendBlock,
  buildCarrierJobId,
  combineAbortSignals,
  createJobArchive,
  finalizeJobArchive,
  formatLaunchResponseText,
  putJobSummary,
  registerJobAbortController,
  toMessageArchiveBlock,
  toThoughtArchiveBlock,
  unregisterJobAbortControllers,
  type CarrierJobLaunchResponse,
  type CarrierJobKind,
  type CarrierJobStatus,
  type CarrierJobSummary,
} from "../../services/job/index.js";
import { finalizeJob } from "../bridge/carrier-panel/index.js";

export interface DetachedFanoutPorts {
  readonly logDebug: (category: string, message: string, options?: unknown) => void;
  readonly enqueueCarrierCompletionPush: (payload: { jobId: string; summary: string }) => void;
}

export interface DetachedFanoutProgress {
  status: string;
  toolCallCount: number;
  lineCount: number;
}

export type DetachedFanoutOneShotResult = Awaited<ReturnType<typeof executeOneShot>>;

export interface DetachedFanoutPermit {
  release: (finished?: { status?: CarrierJobStatus; error?: string; finishedAt?: number }) => void;
}

export interface DetachedFanoutAcceptedJob {
  accepted: true;
  jobId: string;
  permit: DetachedFanoutPermit;
  signal: AbortSignal;
}

export interface DetachedFanoutRejectedJob {
  accepted: false;
  response: ReturnType<typeof launchResponseResult>;
}

export type DetachedFanoutLaunch = DetachedFanoutAcceptedJob | DetachedFanoutRejectedJob;

interface StartDetachedFanoutJobOptions {
  jobKind: CarrierJobKind;
  toolName: "carriers_sortie" | "carrier_squadron" | "carrier_taskforce";
  toolCallId: string | undefined;
  startedAt: number;
  carrierIds: string[];
  signal: AbortSignal | undefined;
}

interface FinalizeDetachedFanoutJobOptions {
  ports: DetachedFanoutPorts;
  jobId: string;
  status: CarrierJobStatus;
  error: string | undefined;
  finishedAt: number;
  summary: CarrierJobSummary;
  permit: DetachedFanoutPermit;
}

interface RunDetachedFanoutTrackOptions<TResult> {
  ports: DetachedFanoutPorts;
  syntheticId: string;
  cliType: string;
  request: string;
  cwd: string;
  modelConfig: { model?: string; effort?: string; budgetTokens?: number } | undefined;
  signal: AbortSignal | undefined;
  progress: DetachedFanoutProgress;
  connectSystemPrompt: string;
  jobId: string;
  archiveCarrierId: string;
  archiveLabel: string;
  sanitizeChunk: (text: string) => string;
  sanitizeToolLabel: (text: string) => string;
  onThought: (text: string) => void;
  onToolCall: (title: string, status: string) => void;
  buildResult: (result: DetachedFanoutOneShotResult) => TResult;
}

export function launchResponseResult(response: CarrierJobLaunchResponse): { content: { type: "text"; text: string }[]; details: CarrierJobLaunchResponse } {
  return {
    content: [{ type: "text", text: formatLaunchResponseText(response, response.accepted) }],
    details: response,
  };
}

export function startDetachedFanoutJob(options: StartDetachedFanoutJobOptions): DetachedFanoutLaunch {
  const jobId = buildCarrierJobId(options.jobKind, options.toolCallId ?? "");
  const permit = acquireJobPermit({
    jobId,
    tool: options.toolName,
    status: "active",
    startedAt: options.startedAt,
    carriers: options.carrierIds,
  });
  if (!permit.accepted) {
    const response = permit.error === "carrier busy"
      ? launchResponseResult({ job_id: jobId, accepted: false, error: permit.error, current_job_id: permit.current_job_id })
      : launchResponseResult({ job_id: jobId, accepted: false, error: permit.error });
    return { accepted: false, response };
  }

  createJobArchive(jobId, options.startedAt);
  const jobController = new AbortController();
  registerJobAbortController(jobId, jobController);
  const signal = options.signal
    ? combineAbortSignals([options.signal, jobController.signal])
    : jobController.signal;
  return { accepted: true, jobId, permit, signal };
}

export function finalizeDetachedFanoutJob(options: FinalizeDetachedFanoutJobOptions): void {
  putJobSummary(options.summary, options.finishedAt);
  finalizeJobArchive(options.jobId, options.status, options.finishedAt);
  options.ports.enqueueCarrierCompletionPush({ jobId: options.jobId, summary: options.summary.summary });
  unregisterJobAbortControllers(options.jobId);
  options.permit.release({ status: options.status, error: options.error, finishedAt: options.finishedAt });
  finalizeJob(options.jobId, options.status === "done" ? "done" : options.status === "aborted" ? "aborted" : "error");
}

export async function runDetachedFanoutTrack<TResult>(options: RunDetachedFanoutTrackOptions<TResult>): Promise<TResult> {
  options.progress.status = "connecting";
  prepareDetachedFanoutRun(options.syntheticId);

  const result = await executeOneShot({
    carrierId: options.syntheticId,
    cliType: options.cliType as any,
    request: options.request,
    cwd: options.cwd,
    model: options.modelConfig?.model,
    effort: options.modelConfig?.effort,
    budgetTokens: options.modelConfig?.budgetTokens,
    connectSystemPrompt: options.connectSystemPrompt,
    signal: options.signal,
    onStatusChange: (status) => {
      updateRunStatus(options.syntheticId, status);
    },
    onMessageChunk: (text: string) => {
      options.progress.status = "streaming";
      options.progress.lineCount++;
      appendTextBlock(options.syntheticId, options.sanitizeChunk(text));
      appendBlock(options.jobId, toMessageArchiveBlock(options.archiveCarrierId, text, options.archiveLabel));
    },
    onThoughtChunk: (text: string) => {
      appendThoughtBlock(options.syntheticId, options.sanitizeChunk(text));
      appendBlock(options.jobId, toThoughtArchiveBlock(options.archiveCarrierId, text, options.archiveLabel));
      options.onThought(text);
    },
    onToolCall: (title: string, status: string, _rawOutput?: string, toolCallId?: string) => {
      options.progress.status = "streaming";
      options.progress.toolCallCount++;
      upsertToolBlock(
        options.syntheticId,
        options.sanitizeToolLabel(title),
        options.sanitizeToolLabel(status),
        toolCallId,
      );
      options.onToolCall(title, status);
    },
  });

  options.progress.status = result.status === "done" ? "done" : "error";
  finalizeDetachedFanoutRun(options.syntheticId, result, options.sanitizeChunk);
  return options.buildResult(result);
}

function prepareDetachedFanoutRun(syntheticId: string): void {
  const existingRun = getVisibleRun(syntheticId);
  if (!existingRun) {
    createRun(syntheticId);
    return;
  }

  existingRun.blocks = [];
  existingRun.status = "conn";
  existingRun.sessionId = undefined;
  existingRun.error = undefined;
  existingRun.requestPreview = undefined;
  existingRun.lastAgentStatus = "connecting";
  existingRun.invalidateCache();
}

function finalizeDetachedFanoutRun(
  syntheticId: string,
  result: DetachedFanoutOneShotResult,
  sanitizeChunk: (text: string) => string,
): void {
  finalizeRun(syntheticId, result.status === "done" ? "done" : "err", {
    error: result.error,
    fallbackText: sanitizeChunk(result.responseText),
    fallbackThinking: sanitizeChunk(result.thoughtText),
  });
}
