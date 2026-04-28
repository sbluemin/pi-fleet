/**
 * fleet/carrier/sortie.ts — Carrier Sortie 도구 등록
 *
 * carrier 위임의 유일한 PI 도구입니다.
 * 1개 이상 Carrier에 작업을 위임(출격)할 때 사용합니다.
 *
 * [호출 인스턴스 격리 설계]
 * 1. 상태 격리: PI가 부여한 `id`(toolCallId)를 `sortieKey`로 사용하여 `globalThis`의 Map 기반 저장소에서
 *    각 호출별 상태(SortieState)를 독립적으로 관리합니다. 이를 통해 동시/연속 호출 시 UI 간섭을 방지합니다.
 * 2. 스트리밍 격리: 각 Carrier가 실행될 때 첫 청크 시점의 `runId`를 캡처하여 `SortieState.runIds`에 저장합니다.
 * 3. renderCall/renderResult는 고정 요약만 담당하고, 실시간 스트리밍 표시는 Agent Panel이 전담합니다.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import {
  buildSortieJobSummary,
  computeSortieFinalStatus,
  validateSortieAssignments,
  type CarrierSortieOutcome,
} from "@sbluemin/fleet-core/carrier";
import type { CliType } from "@sbluemin/unified-agent";

import { getLogAPI } from "../../config-bridge/log/bridge.js";
import { registerToolPromptManifest } from "@sbluemin/fleet-core/admiral/tool-prompt-manifest";
import { runAgentRequestBackground } from "../../session-bridge/fleet/operation-runner.js";
import {
  finalizeJob,
  registerSortieJob,
  updateColumnTrackRunId,
  updateColumnTrackStatus,
} from "@sbluemin/fleet-core/bridge/panel";
import { toMessageArchiveBlock, toThoughtArchiveBlock } from "@sbluemin/fleet-core/job";
import { combineAbortSignals } from "@sbluemin/fleet-core/job";
import { acquireJobPermit } from "@sbluemin/fleet-core/job";
import { registerJobAbortController, unregisterJobAbortControllers } from "@sbluemin/fleet-core/job";
import { buildCarrierJobId } from "@sbluemin/fleet-core/job";
import { formatLaunchResponseText } from "@sbluemin/fleet-core/job";
import { appendBlock, createJobArchive, finalizeJobArchive } from "@sbluemin/fleet-core/job";
import type { CarrierJobLaunchResponse, CarrierJobSummary, CarrierJobStatus } from "@sbluemin/fleet-core/job";
import { putJobSummary } from "@sbluemin/fleet-core/job";
import { enqueueCarrierCompletionPush } from "../../adapters/push/carrier-completion.js";
import { renderRequestPreview } from "../request-preview.js";
import { composeTier2Request } from "./prompts.js";
import { getVisibleRun } from "@sbluemin/fleet-core/bridge/streaming";
import {
  getRegisteredOrder,
  getSortieEnabledIds,
  isSortieCarrierEnabled,
  isSquadronCarrierEnabled,
  resolveCarrierDisplayName,
  getRegisteredCarrierConfig,
} from "./framework.js";
import { ANSI_RESET, SORTIE_SUMMARY_COLOR } from "@sbluemin/fleet-core/constants";
import {
  FLEET_SORTIE_DESCRIPTION,
  SORTIE_MANIFEST,
  buildCarrierSystemPrompt,
  buildSortieToolPromptSnippet,
  buildSortieToolPromptGuidelines,
  buildSortieToolSchema,
  type CarrierAssignment,
} from "./prompts.js";

// ─── 타입 ────────────────────────────────────────────────

/** 개별 Carrier 실행 결과 */
interface CarrierSortieResult extends CarrierSortieOutcome {
  carrierId: string;
  displayName: string;
  status: "done" | "error" | "aborted";
  responseText: string;
  sessionId?: string;
  error?: string;
  thinking?: string;
  toolCalls?: { title: string; status: string }[];
}

interface SortieBackgroundOptions {
  pi: ExtensionAPI;
  jobId: string;
  sortieKey: string;
  assignments: CarrierAssignment[];
  state: SortieState;
  signal: AbortSignal | undefined;
  cwd: string;
  permit: { release: (finished?: { status?: CarrierJobStatus; error?: string; finishedAt?: number }) => void };
  startedAt: number;
}

/** 개별 Carrier의 진행 상태 */
interface CarrierProgress {
  status: "queued" | "connecting" | "streaming" | "done" | "error";
  /** 도구 호출 수 */
  toolCallCount: number;
  /** 응답 라인 수 */
  lineCount: number;
}

/** Sortie 진행 상태 (실행 중에만 존재) */
interface SortieState {
  /** PI가 부여한 고유 tool call ID (호출 인스턴스 격리 키) */
  sortieKey: string;
  /** carrierId → 진행 상태 */
  carriers: Map<string, CarrierProgress>;
  /** carrierId → stream-store runId (스트리밍 콘텐츠 격리용) */
  runIds: Map<string, string>;
  /** 실행 시작 시각 (Date.now()) */
  startedAt: number;
  /** 모든 작업 완료 시각 */
  finishedAt?: number;
}

// ─── 상수 ────────────────────────────────────────────────

/** globalThis 진행 상태 키 (renderCall에서 참조) */
const SORTIE_STATE_KEY = "__pi_carrier_sortie_state__";

const SORTIE_LOG_CATEGORY_INVOKE = "fleet-sortie:invoke";
const SORTIE_LOG_CATEGORY_VALIDATE = "fleet-sortie:validate";
const SORTIE_LOG_CATEGORY_DISPATCH = "fleet-sortie:dispatch";
const SORTIE_LOG_CATEGORY_STREAM = "fleet-sortie:stream";
const SORTIE_LOG_CATEGORY_EXEC = "fleet-sortie:exec";
const SORTIE_LOG_CATEGORY_RESULT = "fleet-sortie:result";
const SORTIE_LOG_CATEGORY_ERROR = "fleet-sortie:error";
const capturedPanelTrackRunIds = new Set<string>();

// ─── 공개 API ────────────────────────────────────────────

/**
 * carriers_sortie 도구 정의(ToolDefinition)를 조립해 반환합니다.
 *
 * 도구 등록 호출 오너쉽은 fleet/index.ts가 부팅 시 1회 등록합니다.
 * 이 팩토리는 등록 시 필요한 schema/guidelines/execute/render 등
 * 도구 기능 자체만을 제공합니다. 등록 불필요 시 null을 반환합니다.
 */
export function buildSortieToolConfig(pi: ExtensionAPI) {
  const allCarriers = getRegisteredOrder();
  if (allCarriers.length < 1) return null; // Carrier가 없으면 등록 불필요

  registerToolPromptManifest(SORTIE_MANIFEST);

  // sortie 가용 carrier만 프롬프트/파라미터에 반영
  const enabledIds = getSortieEnabledIds();

  // 모든 carrier가 비활성이어도 도구 자체는 등록 (execute guard가 거부)
  const mergedGuidelines = buildSortieToolPromptGuidelines(enabledIds);

  return {
    name: "carriers_sortie",
    label: "Carriers Sortie",
    description: FLEET_SORTIE_DESCRIPTION,
    promptSnippet: buildSortieToolPromptSnippet(),
    promptGuidelines: mergedGuidelines,
    parameters: buildSortieToolSchema(enabledIds),

    // ── renderCall: 고정 1줄 요약 (실시간 스트리밍은 Agent Panel 전담) ──
    renderCall(args: unknown, _theme: Theme, _context: any) {
      const typedArgs = args as { carriers?: CarrierAssignment[] };
      const payload = formatSortieRenderPayload(typedArgs.carriers ?? []);
      return {
        render() { return [`  ⚓ ${SORTIE_SUMMARY_COLOR}Sortie${ANSI_RESET}: ${payload}`]; },
        invalidate() {},
      };
    },

    // ── renderResult: 요청 프리뷰 ──
    renderResult(_result: any, options: { expanded: boolean; isPartial: boolean }, _theme: any, context: any) {
      const args = context?.args as { carriers?: Array<{ carrier: string; request: string }> } | undefined;
      const entries = (args?.carriers ?? []).map((carrier) => ({ label: carrier.carrier, text: carrier.request }));
      return {
        render(width: number) {
          return renderRequestPreview(entries, options.expanded, SORTIE_SUMMARY_COLOR, width);
        },
        invalidate() {},
      };
    },

    // ── execute: N개 Carrier 병렬 job 등록 ──
    async execute(
      id: string,
      params: { expected_carrier_count: number; carriers: CarrierAssignment[] },
      signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: ExtensionContext,
    ) {
      const t0 = Date.now();
      const cwd = ctx.cwd;
      const assignments = params.carriers;
      getLogAPI().debug(
        SORTIE_LOG_CATEGORY_INVOKE,
        `execute start carriers=${assignments?.length ?? 0} ids=${(assignments ?? []).map((a) => a.carrier).join(", ") || "(none)"}`,
      );
      const jobId = buildCarrierJobId("sortie", id);
      const allIds = new Set(getRegisteredOrder());
      const enabledIds = new Set(getSortieEnabledIds());
      const validation = validateSortieAssignments({
        expectedCount: params.expected_carrier_count,
        assignments,
        registeredIds: [...allIds],
        enabledIds: [...enabledIds],
        jobId,
        resolveUnavailableReason(carrierId) {
          return isSquadronCarrierEnabled(carrierId)
            ? "assigned to squadron (use carrier_squadron instead)"
            : !isSortieCarrierEnabled(carrierId)
              ? "manually disabled"
              : "unavailable";
        },
      });
      if (validation.rejection) {
        getLogAPI().debug(SORTIE_LOG_CATEGORY_ERROR, `carrier unavailable error=${validation.rejection.error}`);
        return launchResponseResult(validation.rejection);
      }
      getLogAPI().debug(
        SORTIE_LOG_CATEGORY_VALIDATE,
        `validated carriers=${assignments.length} ids=${assignments.map((a) => a.carrier).join(", ")}`,
      );

      const permit = acquireJobPermit({
        jobId,
        tool: "carriers_sortie",
        status: "active",
        startedAt: t0,
        carriers: assignments.map((assignment) => assignment.carrier),
      });
      if (!permit.accepted) {
        return permit.error === "carrier busy"
          ? launchResponseResult({ job_id: jobId, accepted: false, error: permit.error, current_job_id: permit.current_job_id })
          : launchResponseResult({ job_id: jobId, accepted: false, error: permit.error });
      }

      createJobArchive(jobId, t0);
      const jobController = new AbortController();
      registerJobAbortController(jobId, jobController);

      const effectiveSignal = signal
        ? combineAbortSignals([signal, jobController.signal])
        : jobController.signal;

      // 진행 상태 초기화 (id = PI tool call ID로 호출 인스턴스를 고유 식별)
      const sortieKey = id;
      const state = initSortieState(sortieKey, assignments.map((a) => a.carrier));
      registerSortieJob(
        jobId,
        assignments[0]!.carrier,
        `${assignments.length} carrier${assignments.length === 1 ? "" : "s"}`,
        assignments.map((assignment) => ({
          trackId: assignment.carrier,
          streamKey: assignment.carrier,
          displayCli: assignment.carrier,
          displayName: resolveCarrierDisplayName(assignment.carrier),
          kind: "carrier" as const,
        })),
        id,
      );

      void runSortieJobInBackground({
        pi,
        jobId,
        sortieKey,
        assignments,
        state,
        signal: effectiveSignal,
        cwd,
        permit,
        startedAt: t0,
      });

      getLogAPI().debug(SORTIE_LOG_CATEGORY_RESULT, `run=${sortieKey} accepted job=${jobId}`);
      return launchResponseResult({ job_id: jobId, accepted: true });
    },
  };
}

// ─── 내부 헬퍼 ──────────────────────────────────────────

async function runSortieJobInBackground(opts: SortieBackgroundOptions): Promise<void> {
  let finalStatus: CarrierJobStatus = "done";
  let finalError: string | undefined;
  let results: CarrierSortieResult[] = [];
  try {
    const settledResults = await Promise.allSettled(
      opts.assignments.map((assignment) => runSortieAssignment(assignment, opts)),
    );
    opts.state.finishedAt = Date.now();
    results = settledResults.map((settled, index) => {
      if (settled.status === "fulfilled") return settled.value;
      return buildSortieErrorResult(opts.assignments[index]!.carrier, settled.reason);
    });
    finalStatus = computeSortieFinalStatus(results);
    getLogAPI().debug(
      SORTIE_LOG_CATEGORY_RESULT,
      `run=${opts.sortieKey} success=${results.filter((r) => r.status === "done").length} failure=${results.filter((r) => r.status !== "done").length}`,
    );
  } catch (error) {
    finalStatus = "error";
    finalError = error instanceof Error ? error.message : String(error);
  } finally {
    const finishedAt = Date.now();
    const summary = buildSortieJobSummary(opts.jobId, opts.startedAt, finishedAt, opts.assignments, results, finalStatus, finalError);
    putJobSummary(summary, finishedAt);
    finalizeJobArchive(opts.jobId, finalStatus, finishedAt);
    enqueueCarrierCompletionPush(opts.pi, { jobId: opts.jobId, summary: summary.summary });
    unregisterJobAbortControllers(opts.jobId);
    opts.permit.release({ status: finalStatus, error: finalError, finishedAt });
    finalizeJob(opts.jobId, finalStatus === "done" ? "done" : finalStatus === "aborted" ? "aborted" : "error");
    clearCapturedPanelTrackRunIds(opts.jobId);
    clearSortieState(opts.sortieKey);
    getLogAPI().debug(SORTIE_LOG_CATEGORY_INVOKE, `execute end elapsedMs=${finishedAt - opts.startedAt}`);
  }
}

function launchResponseResult(response: CarrierJobLaunchResponse): { content: { type: "text"; text: string }[]; details: CarrierJobLaunchResponse } {
  return {
    content: [{ type: "text", text: formatLaunchResponseText(response, response.accepted) }],
    details: response,
  };
}

async function runSortieAssignment(
  assignment: CarrierAssignment,
  opts: SortieBackgroundOptions,
): Promise<CarrierSortieResult> {
  const execStartedAt = Date.now();
  const progress = opts.state.carriers.get(assignment.carrier)!;
  progress.status = "connecting";
  const carrierConfig = getRegisteredCarrierConfig(assignment.carrier);
  const cliType = carrierConfig?.cliType ?? assignment.carrier;
  const composedRequest = carrierConfig?.carrierMetadata
    ? composeTier2Request(carrierConfig.carrierMetadata, assignment.request)
    : assignment.request;
  getLogAPI().debug(
    SORTIE_LOG_CATEGORY_DISPATCH,
    [
      `carrier=${assignment.carrier} model=${cliType} promptChars=${composedRequest.length} run=${opts.sortieKey}`,
      "----- BEGIN REQUEST -----",
      composedRequest,
      "----- END REQUEST -----",
    ].join("\n"),
    { hideFromFooter: true, category: "prompt" },
  );
  try {
    const result = await runAgentRequestBackground({
      cli: cliType as CliType,
      carrierId: assignment.carrier,
      request: composedRequest,
      cwd: opts.cwd,
      connectSystemPrompt: buildCarrierSystemPrompt(),
      signal: opts.signal,
      onMessageChunk: (text: string) => {
        progress.status = "streaming";
        progress.lineCount++;
        appendBlock(opts.jobId, toMessageArchiveBlock(assignment.carrier, text));
        captureSortieRunId(opts.state, assignment.carrier);
        capturePanelTrackRunId(opts.jobId, assignment.carrier);
        updateColumnTrackStatus(opts.jobId, assignment.carrier, "stream");
      },
      onThoughtChunk: (text: string) => {
        appendBlock(opts.jobId, toThoughtArchiveBlock(assignment.carrier, text));
        captureSortieRunId(opts.state, assignment.carrier);
        capturePanelTrackRunId(opts.jobId, assignment.carrier);
        updateColumnTrackStatus(opts.jobId, assignment.carrier, "stream");
      },
      onToolCall: (toolTitle: string, toolStatus: string, _rawOutput?: string, _toolCallId?: string) => {
        progress.status = "streaming";
        progress.toolCallCount++;
        captureSortieRunId(opts.state, assignment.carrier);
        capturePanelTrackRunId(opts.jobId, assignment.carrier);
        updateColumnTrackStatus(opts.jobId, assignment.carrier, "stream");
        getLogAPI().debug(SORTIE_LOG_CATEGORY_STREAM, `carrier=${assignment.carrier} type=toolCall title=${toolTitle} status=${toolStatus}`, { hideFromFooter: true });
      },
    });
    progress.status = result.status === "done" ? "done" : "error";
    updateColumnTrackStatus(
      opts.jobId,
      assignment.carrier,
      result.status === "done" ? "done" : result.status === "aborted" ? "err" : "err",
    );
    getLogAPI().debug(SORTIE_LOG_CATEGORY_EXEC, `carrier=${assignment.carrier} success=${result.status === "done"} status=${result.status} elapsedMs=${Date.now() - execStartedAt}`);
    return {
      carrierId: assignment.carrier,
      displayName: resolveCarrierDisplayName(assignment.carrier),
      status: result.status,
      responseText: result.responseText || "(no output)",
      sessionId: result.sessionId,
      error: result.error,
      thinking: result.thinking,
      toolCalls: result.toolCalls,
    } as CarrierSortieResult;
  } catch (error) {
    updateColumnTrackStatus(opts.jobId, assignment.carrier, "err");
    getLogAPI().debug(SORTIE_LOG_CATEGORY_EXEC, `carrier=${assignment.carrier} success=false status=error elapsedMs=${Date.now() - execStartedAt}`);
    throw error;
  }
}

function captureSortieRunId(state: SortieState, carrierId: string): void {
  if (state.runIds.has(carrierId)) return;
  const run = getVisibleRun(carrierId);
  if (run) state.runIds.set(carrierId, run.runId);
}

function capturePanelTrackRunId(jobId: string, carrierId: string): void {
  const key = `${jobId}:${carrierId}`;
  if (capturedPanelTrackRunIds.has(key)) return;
  const run = getVisibleRun(carrierId);
  if (!run) return;
  updateColumnTrackRunId(jobId, carrierId, run.runId);
  capturedPanelTrackRunIds.add(key);
}

function clearCapturedPanelTrackRunIds(jobId: string): void {
  for (const key of Array.from(capturedPanelTrackRunIds)) {
    if (key.startsWith(`${jobId}:`)) capturedPanelTrackRunIds.delete(key);
  }
}

function buildSortieErrorResult(carrierId: string, reason: unknown): CarrierSortieResult {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  getLogAPI().debug(SORTIE_LOG_CATEGORY_ERROR, `carrier=${carrierId} message=${errorMessage}`);
  return {
    carrierId,
    displayName: resolveCarrierDisplayName(carrierId),
    status: "error",
    responseText: `Error: ${errorMessage}`,
    error: errorMessage,
  };
}

// ─── State Store (Map<sortieKey, SortieState>) ─────────

function getStateStore(): Map<string, SortieState> {
  let store = (globalThis as any)[SORTIE_STATE_KEY] as Map<string, SortieState> | undefined;
  if (!store) {
    store = new Map();
    (globalThis as any)[SORTIE_STATE_KEY] = store;
  }
  return store;
}

function initSortieState(sortieKey: string, carrierIds: string[]): SortieState {
  const store = getStateStore();
  const state: SortieState = {
    sortieKey,
    carriers: new Map(
      carrierIds.map((id) => [id, { status: "queued", toolCallCount: 0, lineCount: 0 }]),
    ),
    runIds: new Map(),
    startedAt: Date.now(),
  };
  store.set(sortieKey, state);
  return state;
}

function clearSortieState(sortieKey: string): void {
  const store = getStateStore();
  store.delete(sortieKey);
}

function formatSortieRenderPayload(assignments: CarrierAssignment[]): string {
  if (assignments.length === 0) {
    return `${SORTIE_SUMMARY_COLOR}...${ANSI_RESET}`;
  }

  return assignments
    .map((assignment) => `${SORTIE_SUMMARY_COLOR}${assignment.carrier}${ANSI_RESET}`)
    .join(`${SORTIE_SUMMARY_COLOR}, ${ANSI_RESET}`);
}
