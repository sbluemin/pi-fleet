/**
 * fleet/shipyard/squadron/squadron.ts — carrier_squadron 도구 등록
 *
 * 동일 캐리어 타입의 여러 인스턴스를 병렬로 출격하여
 * 하나의 임무를 분할 처리합니다.
 *
 * - execute(): executeOneShot 기반 비세션 병렬 실행
 * - renderCall/renderResult: 고정 요약만 반환하고 실시간 스트리밍은 Agent Panel이 전담
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";

import { getLogAPI } from "../../../core/log/bridge.js";
import { executeOneShot } from "../../../core/agentclientprotocol/executor.js";
import { registerToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import { finalizeJob, registerSquadronJob } from "../../bridge/panel/jobs.js";
import { toMessageArchiveBlock, toThoughtArchiveBlock } from "../_shared/archive-block-converter.js";
import { combineAbortSignals } from "../_shared/abort-signals.js";
import { acquireJobPermit } from "../_shared/concurrency-guard.js";
import { registerJobAbortController, unregisterJobAbortControllers } from "../_shared/job-cancel-registry.js";
import { buildCarrierJobId } from "../_shared/job-id.js";
import { formatLaunchResponseText } from "../_shared/job-reminders.js";
import { appendBlock, createJobArchive, finalizeJobArchive } from "../_shared/job-stream-archive.js";
import type { CarrierJobLaunchResponse, CarrierJobSummary, CarrierJobStatus } from "../_shared/job-types.js";
import { putJobSummary } from "../_shared/lru-cache.js";
import { enqueueCarrierCompletionPush } from "../_shared/push.js";
import { renderRequestPreview } from "../_shared/request-preview.js";
import { loadModels } from "../store.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  finalizeRun,
  updateRunStatus,
  getVisibleRun,
} from "../../bridge/streaming/stream-store.js";
import {
  getActiveSquadronIds,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  isSortieCarrierEnabled,
  isSquadronCarrierEnabled,
  resolveCarrierDisplayName,
} from "../carrier/framework.js";
import { ANSI_RESET, SQUADRON_BADGE_COLOR } from "../../constants.js";
import { buildCarrierSystemPrompt, composeTier2Request } from "../carrier/prompts.js";
import {
  FLEET_SQUADRON_DESCRIPTION,
  SQUADRON_MANIFEST,
  buildSquadronPromptSnippet,
  buildSquadronPromptGuidelines,
  buildSquadronSchema,
} from "./prompts.js";
import {
  SQUADRON_STATE_KEY,
  SQUADRON_MAX_INSTANCES,
  type SubtaskProgress,
  type SquadronResult,
  type SquadronState,
} from "./types.js";

// ─── 타입 ────────────────────────────────────────────────

interface SquadronBackgroundOptions {
  pi: ExtensionAPI;
  jobId: string;
  carrierId: string;
  requestKey: string;
  sanitizedSubtasks: Array<{ title: string; request: string }>;
  composedSubtasks: string[];
  state: SquadronState;
  signal: AbortSignal | undefined;
  cwd: string;
  carrierConfig: ReturnType<typeof getRegisteredCarrierConfig>;
  permit: { release: (finished?: { status?: CarrierJobStatus; error?: string; finishedAt?: number }) => void };
  startedAt: number;
}

const SQUADRON_RUN_PREFIX = "squadron";
const SQUADRON_LOG_CATEGORY_INVOKE = "fleet-squadron:invoke";
const SQUADRON_LOG_CATEGORY_VALIDATE = "fleet-squadron:validate";
const SQUADRON_LOG_CATEGORY_DISPATCH = "fleet-squadron:dispatch";
const SQUADRON_LOG_CATEGORY_STREAM = "fleet-squadron:stream";
const SQUADRON_LOG_CATEGORY_EXEC = "fleet-squadron:exec";
const SQUADRON_LOG_CATEGORY_RESULT = "fleet-squadron:result";
const SQUADRON_LOG_CATEGORY_ERROR = "fleet-squadron:error";

// ─── 공개 API ────────────────────────────────────────────

/**
 * carrier_squadron 도구 정의(ToolDefinition)를 조립해 반환합니다.
 *
 * pi.registerTool 호출 오너쉽은 fleet/index.ts가 부팅 시 1회 등록합니다.
 * 이 팩토리는 등록 시 필요한 schema/guidelines/execute/render 등
 * 도구 기능 자체만을 제공합니다. 등록 불필요 시 null을 반환합니다.
 */
export function buildSquadronToolConfig(pi: ExtensionAPI) {
  const allCarriers = getRegisteredOrder();
  if (allCarriers.length < 1) return null;

  registerToolPromptManifest(SQUADRON_MANIFEST);

  // squadron 활성 캐리어만 스키마/가이드라인에 반영
  const enabledCarriers = getActiveSquadronIds();
  const guidelines = buildSquadronPromptGuidelines(enabledCarriers);

  return {
    name: "carrier_squadron",
    label: "Carrier Squadron",
    description: FLEET_SQUADRON_DESCRIPTION,
    promptSnippet: buildSquadronPromptSnippet(),
    promptGuidelines: guidelines,
    parameters: buildSquadronSchema(enabledCarriers),

    // ── renderCall: 고정 1줄 요약 (실시간 스트리밍은 Agent Panel 전담) ──
    renderCall(args: unknown, _theme: Theme, _context: any) {
      const typedArgs = args as {
        carrier?: string;
        subtasks?: Array<{ title: string; request: string }>;
      };
      const carrier = typedArgs.carrier ?? "...";
      const count = typedArgs.subtasks?.length ?? 0;
      return {
        render() { return [`  ⚓ ${SQUADRON_BADGE_COLOR}Squadron${ANSI_RESET}: ${SQUADRON_BADGE_COLOR}${carrier} ×${count} subtasks${ANSI_RESET}`]; },
        invalidate() {},
      };
    },

    // ── renderResult: 요청 프리뷰 ──
    renderResult(_result: any, options: { expanded: boolean; isPartial: boolean }, _theme: any, context: any) {
      const args = context?.args as { subtasks?: Array<{ title: string; request: string }> } | undefined;
      const lines = renderRequestPreview(
        (args?.subtasks ?? []).map((subtask) => ({ label: `"${subtask.title}"`, text: subtask.request })),
        options.expanded,
        SQUADRON_BADGE_COLOR,
      );
      return { render() { return lines; }, invalidate() {} };
    },

    // ── execute: 병렬 job 등록 ──
    async execute(
      _id: string,
      params: { carrier: string; expected_subtask_count: number; subtasks: Array<{ title: string; request: string }> },
      signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: ExtensionContext,
    ) {
      const t0 = Date.now();
      const cwd = ctx.cwd;
      const { carrier: carrierId, expected_subtask_count, subtasks } = params;
      getLogAPI().debug(
        SQUADRON_LOG_CATEGORY_INVOKE,
        `execute start carrier=${carrierId} subtasks=${subtasks.length} ids=${subtasks.map((_, index) => `${index}`).join(", ") || "(none)"}`,
      );

      // 1. 검증
      assertRegisteredCarrier(carrierId);
      assertSortieEnabled(carrierId);
      assertSquadronEnabled(carrierId);
      assertSubtaskCount(expected_subtask_count, subtasks.length);
      assertSubtaskLimit(subtasks.length);
      getLogAPI().debug(
        SQUADRON_LOG_CATEGORY_VALIDATE,
        `validated carrier=${carrierId} expected=${expected_subtask_count} subtasks=${subtasks.length}`,
      );

      // 1.5. title 새니타이즈 — 경계 마커 인젝션 방지
      const sanitizedSubtasks = subtasks.map((st) => ({
        title: sanitizeTitle(st.title),
        request: st.request,
      }));

      // 2. Tier 2 request 조합 (base 캐리어의 persona 상속)
      const carrierConfig = getRegisteredCarrierConfig(carrierId);
      const composedSubtasks = sanitizedSubtasks.map((st) =>
        carrierConfig?.carrierMetadata
          ? composeTier2Request(carrierConfig.carrierMetadata, st.request)
          : st.request,
      );

      const jobId = buildCarrierJobId("squadron", _id);
      const permit = acquireJobPermit({
        jobId,
        tool: "carrier_squadron",
        status: "active",
        startedAt: t0,
        carriers: [carrierId],
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

      // 3. 진행 상태 초기화
      const requestKey = buildSquadronRequestKey(carrierId, sanitizedSubtasks);
      const state = initSquadronState(carrierId, requestKey, sanitizedSubtasks);

      void runSquadronJobInBackground({
        pi,
        jobId,
        carrierId,
        requestKey,
        sanitizedSubtasks,
        composedSubtasks,
        state,
        signal: effectiveSignal,
        cwd,
        carrierConfig,
        permit,
        startedAt: t0,
      });

      getLogAPI().debug(SQUADRON_LOG_CATEGORY_RESULT, `carrier=${carrierId} accepted job=${jobId}`);
      return launchResponseResult({ job_id: jobId, accepted: true });
    },
  };
}

// ─── 내부 상태 관리 ──────────────────────────────────────

async function runSquadronJobInBackground(opts: SquadronBackgroundOptions): Promise<void> {
  let finalStatus: CarrierJobStatus = "done";
  let finalError: string | undefined;
  let results: SquadronResult[] = [];
  registerSquadronJob(
    opts.jobId,
    opts.carrierId,
    `${opts.sanitizedSubtasks.length} subtasks`,
    opts.sanitizedSubtasks.map((subtask, index) => ({
      trackId: `${index}`,
      streamKey: buildSquadronRunId(opts.requestKey, index),
      displayCli: opts.carrierId,
      runId: getVisibleRun(buildSquadronRunId(opts.requestKey, index))?.runId,
      displayName: subtask.title,
      subtitle: resolveCarrierDisplayName(opts.carrierId),
      kind: "subtask" as const,
    })),
  );
  try {
    const modelConfig = loadModels()[opts.carrierId];
    const cliType = opts.carrierConfig?.cliType ?? "claude";
    const settledResults = await Promise.allSettled(
      opts.sanitizedSubtasks.map((st, index) =>
        runSquadronInstance(index, st.title, opts.composedSubtasks[index]!, {
          carrierId: opts.carrierId,
          cliType,
          modelConfig,
          state: opts.state,
          signal: opts.signal,
          cwd: opts.cwd,
          requestKey: opts.requestKey,
          totalSubtasks: opts.sanitizedSubtasks.length,
          jobId: opts.jobId,
        }),
      ),
    );
    opts.state.finishedAt = Date.now();
    results = collectSquadronResults(settledResults, opts.sanitizedSubtasks);
    finalStatus = computeFinalStatus(results);
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_RESULT,
      `carrier=${opts.carrierId} success=${results.filter((r) => r.status === "done").length} failure=${results.filter((r) => r.status !== "done").length}`,
    );
  } catch (error) {
    finalStatus = "error";
    finalError = error instanceof Error ? error.message : String(error);
  } finally {
    const finishedAt = Date.now();
    const summary = buildSquadronJobSummary(opts.jobId, opts.startedAt, finishedAt, opts.carrierId, results, finalStatus, finalError);
    putJobSummary(summary, finishedAt);
    finalizeJobArchive(opts.jobId, finalStatus, finishedAt);
    enqueueCarrierCompletionPush(opts.pi, { jobId: opts.jobId, summary: summary.summary });
    unregisterJobAbortControllers(opts.jobId);
    opts.permit.release({ status: finalStatus, error: finalError, finishedAt });
    finalizeJob(opts.jobId, finalStatus === "done" ? "done" : finalStatus === "aborted" ? "aborted" : "error");
    clearSquadronState(opts.requestKey);
    getLogAPI().debug(SQUADRON_LOG_CATEGORY_INVOKE, `execute end carrier=${opts.carrierId} elapsedMs=${finishedAt - opts.startedAt}`);
  }
}

function computeFinalStatus(results: SquadronResult[]): CarrierJobStatus {
  if (results.some((result) => result.status === "aborted")) return "aborted";
  if (results.some((result) => result.status === "error")) return "error";
  return "done";
}

function launchResponseResult(response: CarrierJobLaunchResponse): { content: { type: "text"; text: string }[]; details: CarrierJobLaunchResponse } {
  return {
    content: [{ type: "text", text: formatLaunchResponseText(response, response.accepted) }],
    details: response,
  };
}

function formatCarrierIdForMessage(carrierId: string): string {
  return JSON.stringify(carrierId);
}

function assertRegisteredCarrier(carrierId: string): void {
  const allIds = new Set(getRegisteredOrder());
  if (!allIds.has(carrierId)) {
    const registered = [...allIds].map(formatCarrierIdForMessage).join(", ") || "(none)";
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `unknown carrier carrier=${carrierId}`,
    );
    throw new Error(
      `Unknown carrier: ${formatCarrierIdForMessage(carrierId)}. Registered carriers: ${registered}`,
    );
  }
}

function assertSortieEnabled(carrierId: string): void {
  if (isSortieCarrierEnabled(carrierId)) return;
  getLogAPI().debug(
    SQUADRON_LOG_CATEGORY_ERROR,
    `carrier=${carrierId} sortieEnabled=false reason=manually disabled`,
  );
  throw new Error(
    `Carrier ${formatCarrierIdForMessage(carrierId)} is not available for squadron: manually disabled.`,
  );
}

function assertSquadronEnabled(carrierId: string): void {
  if (!isSquadronCarrierEnabled(carrierId)) {
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `carrier=${carrierId} squadronEnabled=false`,
    );
    throw new Error(
      `Carrier ${formatCarrierIdForMessage(carrierId)} is not enabled for Squadron.\n` +
      `→ Open Carrier Status (Alt+O), select ${formatCarrierIdForMessage(carrierId)}, press S to enable.`,
    );
  }
}

function assertSubtaskCount(expected: number, actual: number): void {
  if (expected !== actual) {
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `subtask count mismatch expected=${expected} actual=${actual}`,
    );
    throw new Error(
      `expected_subtask_count (${expected}) does not match subtasks array length (${actual}).` +
      ` These must be equal.`,
    );
  }
}

function assertSubtaskLimit(count: number): void {
  if (count < 1) {
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `subtask count invalid count=${count}`,
    );
    throw new Error(`At least 1 subtask is required.`);
  }
  if (count > SQUADRON_MAX_INSTANCES) {
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `subtask count over limit count=${count} max=${SQUADRON_MAX_INSTANCES}`,
    );
    throw new Error(
      `Too many subtasks: ${count} exceeds maximum of ${SQUADRON_MAX_INSTANCES}.`,
    );
  }
}

async function runSquadronInstance(
  index: number,
  title: string,
  request: string,
  opts: {
    carrierId: string;
    cliType: string;
    modelConfig: { model?: string; effort?: string; budgetTokens?: number } | undefined;
    state: SquadronState;
    signal: AbortSignal | undefined;
    cwd: string;
    requestKey: string;
    totalSubtasks: number;
    jobId: string;
  },
): Promise<SquadronResult> {
  const execStartedAt = Date.now();
  const progress = opts.state.subtasks.get(index)!;
  progress.status = "connecting";

  // Synthetic ID: squadron:<base64url(requestKey)>:<index>
  const syntheticId = buildSquadronRunId(opts.requestKey, index);

  // synthetic run 생성/재사용 (taskforce 패턴)
  prepareSquadronRun(syntheticId);
  getLogAPI().debug(
    SQUADRON_LOG_CATEGORY_DISPATCH,
    [
      `carrier=${opts.carrierId} subtask=${index} model=${opts.modelConfig?.model ?? opts.cliType} promptChars=${request.length} run=${syntheticId}`,
      "----- BEGIN REQUEST -----",
      request,
      "----- END REQUEST -----",
    ].join("\n"),
    { hideFromFooter: true, category: "prompt" },
  );

  try {
    const result = await executeOneShot({
      carrierId: syntheticId,
      cliType: opts.cliType as any,
      request,
      cwd: opts.cwd,
      model: opts.modelConfig?.model,
      effort: opts.modelConfig?.effort,
      budgetTokens: opts.modelConfig?.budgetTokens,
      connectSystemPrompt: buildCarrierSystemPrompt(),
      signal: opts.signal,
      onStatusChange: (status) => {
        updateRunStatus(syntheticId, status);
      },
      onMessageChunk: (text: string) => {
        progress.status = "streaming";
        progress.lineCount++;
        appendTextBlock(syntheticId, sanitizeChunk(text));
        appendBlock(opts.jobId, toMessageArchiveBlock(opts.carrierId, text, `subtask ${index}: ${title}`));
      },
      onThoughtChunk: (text: string) => {
        appendThoughtBlock(syntheticId, sanitizeChunk(text));
        appendBlock(opts.jobId, toThoughtArchiveBlock(opts.carrierId, text, `subtask ${index}: ${title}`));
        getLogAPI().debug(SQUADRON_LOG_CATEGORY_STREAM, `carrier=${opts.carrierId} subtask=${index} type=thought\n${text}`, { hideFromFooter: true });
      },
      onToolCall: (toolTitle: string, toolStatus: string, _rawOutput?: string, toolCallId?: string) => {
        progress.status = "streaming";
        progress.toolCallCount++;
        upsertToolBlock(
          syntheticId,
          sanitizeToolLabel(toolTitle),
          sanitizeToolLabel(toolStatus),
          toolCallId,
        );
        getLogAPI().debug(SQUADRON_LOG_CATEGORY_STREAM, `carrier=${opts.carrierId} subtask=${index} type=toolCall title=${sanitizeToolLabel(toolTitle)} status=${sanitizeToolLabel(toolStatus)}`, { hideFromFooter: true });
      },
    });

    progress.status = result.status === "done" ? "done" : "error";
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_EXEC,
      `carrier=${opts.carrierId} subtask=${index} success=${result.status === "done"} status=${result.status} elapsedMs=${Date.now() - execStartedAt}`,
    );
    finalizeSquadronRun(syntheticId, result);
    return buildSquadronResult(index, title, result);
  } catch (error) {
    getLogAPI().debug(
      SQUADRON_LOG_CATEGORY_EXEC,
      `carrier=${opts.carrierId} subtask=${index} success=false status=error elapsedMs=${Date.now() - execStartedAt}`,
    );
    throw error;
  }
}

function finalizeSquadronRun(syntheticId: string, result: Awaited<ReturnType<typeof executeOneShot>>): void {
  finalizeRun(syntheticId, result.status === "done" ? "done" : "err", {
    error: result.error,
    fallbackText: sanitizeChunk(result.responseText),
    fallbackThinking: sanitizeChunk(result.thoughtText),
  });
}

function buildSquadronResult(
  index: number,
  title: string,
  result: Awaited<ReturnType<typeof executeOneShot>>,
): SquadronResult {
  return {
    index,
    title,
    status: result.status as "done" | "error" | "aborted",
    responseText: sanitizeChunk(result.responseText) || "(no output)",
    error: result.error ? sanitizeChunk(result.error) : undefined,
    thinking: result.thoughtText ? sanitizeChunk(result.thoughtText) : undefined,
    toolCalls: result.toolCalls.map((tc) => ({
      title: sanitizeToolLabel(tc.title),
      status: sanitizeToolLabel(tc.status),
    })),
  };
}

function collectSquadronResults(
  settledResults: PromiseSettledResult<SquadronResult>[],
  subtasks: Array<{ title: string; request: string }>,
): SquadronResult[] {
  return settledResults.map((settled, index) => {
    if (settled.status === "fulfilled") return settled.value;
    return buildSquadronErrorResult(index, subtasks[index]!.title, settled.reason);
  });
}

function buildSquadronErrorResult(index: number, title: string, reason: unknown): SquadronResult {
  const errorMessage = sanitizeChunk(
    reason instanceof Error ? reason.message : String(reason),
  );
  getLogAPI().debug(
    SQUADRON_LOG_CATEGORY_ERROR,
    `subtask=${index} title=${title} message=${errorMessage}`,
  );
  return {
    index,
    title,
    status: "error",
    responseText: `Error: ${errorMessage}`,
    error: errorMessage,
  };
}

function buildSquadronJobSummary(
  jobId: string,
  startedAt: number,
  finishedAt: number,
  carrierId: string,
  results: SquadronResult[],
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

function buildSquadronSummaryText(status: CarrierJobStatus, successCount: number, failureCount: number, error?: string): string {
  if (status === "aborted") return `carrier_squadron aborted: ${successCount} done, ${failureCount} failed`;
  if (error) return `carrier_squadron failed: ${error}`;
  return `carrier_squadron completed: ${successCount} done, ${failureCount} failed`;
}

// ─── State Store (Map<requestKey, SquadronState>) ──────

function getStateStore(): Map<string, SquadronState> {
  let store = (globalThis as any)[SQUADRON_STATE_KEY] as Map<string, SquadronState> | undefined;
  if (!store) {
    store = new Map();
    (globalThis as any)[SQUADRON_STATE_KEY] = store;
  }
  return store;
}

/** requestKey로 state를 직접 조회 */
function getSquadronState(requestKey: string): SquadronState | null {
  return getStateStore().get(requestKey) ?? null;
}

function initSquadronState(
  carrierId: string,
  requestKey: string,
  subtasks: Array<{ title: string; request: string }>,
): SquadronState {
  const store = getStateStore();
  const state: SquadronState = {
    carrierId,
    requestKey,
    subtasks: new Map(
      subtasks.map((_, i) => [i, { status: "queued", toolCallCount: 0, lineCount: 0 }]),
    ),
    subtaskTitles: subtasks.map((st) => st.title),
    startedAt: Date.now(),
  };
  store.set(requestKey, state);
  return state;
}

function clearSquadronState(requestKey: string): void {
  const store = getStateStore();
  store.delete(requestKey);
}

/** args 기반 안정 키 — renderCall과 execute 양쪽에서 동일한 키를 재구성 가능 */
function buildSquadronRequestKey(
  carrierId: string,
  subtasks: Array<{ title: string; request: string }>,
): string {
  return JSON.stringify([carrierId, subtasks.map((st) => [st.title, st.request])]);
}

/** requestKey 기반 synthetic run ID — execute/renderCall 양쪽에서 동일하게 생성 */
function buildSquadronRunId(requestKey: string, index: number): string {
  const encodedKey = Buffer.from(requestKey, "utf-8").toString("base64url");
  return `${SQUADRON_RUN_PREFIX}:${encodedKey}:${index}`;
}

function prepareSquadronRun(syntheticId: string): void {
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

function sanitizeChunk(text: string): string {
  return text
    .replace(/\r/g, "")
    // CSI 시퀀스 제거
    .replace(/\x1b\[\d*[ABCDEFGHJKST]/g, "")
    .replace(/\x1b\[\d*;\d*[Hf]/g, "")
    .replace(/\x1b\[(?:\??\d+[hl]|2J|K)/g, "")
    // OSC 시퀀스 제거 (\x1b]...\x07 또는 \x1b]...\x1b\\)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    // DCS/APC/PM 시퀀스 제거 (\x1bP...\x1b\\, \x1b_...\x1b\\, \x1b^...\x1b\\)
    .replace(/\x1b[P_^][\s\S]*?\x1b\\/g, "")
    // 제어 문자 제거
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function sanitizeToolLabel(text: string): string {
  return sanitizeChunk(text).replace(/\s+/g, " ").trim() || "(unnamed)";
}

/** 서브태스크 title 새니타이즈 — 경계 마커 인젝션 및 길이 초과 방지 */
const MAX_TITLE_LENGTH = 64;
function sanitizeTitle(text: string): string {
  return text
    .replace(/[\r\n]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/<<<|>>>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH) || "(untitled)";
}
