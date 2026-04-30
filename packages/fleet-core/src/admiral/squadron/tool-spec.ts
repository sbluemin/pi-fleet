/**
 * squadron/tool-spec.ts — carrier_squadron 도구 스펙
 *
 * 동일 캐리어 타입의 여러 인스턴스를 병렬로 출격하여
 * 하나의 임무를 분할 처리합니다.
 *
 * - execute(): executeOneShot 기반 비세션 병렬 실행
 * - renderCall/renderResult: 고정 요약만 반환하고 실시간 스트리밍은 Agent Panel이 전담
 */

import type { AgentToolSpec } from "../../public/tool-registry-services.js";
import { executeOneShot } from "../../services/agent/dispatcher/executor.js";
import { registerToolPromptManifest } from "../../services/tool-registry/index.js";
import { finalizeJob, registerSquadronJob } from "../bridge/carrier-panel/index.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  finalizeRun,
  updateRunStatus,
  getVisibleRun,
} from "../bridge/run-stream/index.js";
import { ANSI_RESET, SQUADRON_BADGE_COLOR } from "../../constants.js";
import {
  toMessageArchiveBlock,
  toThoughtArchiveBlock,
  combineAbortSignals,
  acquireJobPermit,
  registerJobAbortController,
  unregisterJobAbortControllers,
  buildCarrierJobId,
  formatLaunchResponseText,
  appendBlock,
  createJobArchive,
  finalizeJobArchive,
  putJobSummary,
} from "../../services/job/index.js";
import {
  FLEET_SQUADRON_DESCRIPTION,
  SQUADRON_MANIFEST,
  buildSquadronPromptSnippet,
  buildSquadronPromptGuidelines,
  buildSquadronSchema,
} from "./prompts.js";
import {
  buildSquadronJobSummary,
  buildSquadronRequestKey,
  buildSquadronRunId,
  computeSquadronFinalStatus,
  sanitizeSquadronSubtasks,
  sanitizeSquadronTitle,
  validateSquadronSubtaskCount,
  validateSquadronSubtaskLimit,
} from "./squadron-execute.js";
import {
  SQUADRON_STATE_KEY,
  SQUADRON_MAX_INSTANCES,
  type SubtaskProgress,
  type SquadronResult,
  type SquadronState,
} from "./types.js";
import type { CarrierJobLaunchResponse, CarrierJobSummary, CarrierJobStatus } from "../../services/job/index.js";
import { loadModels } from "../store/index.js";

import {
  getActiveSquadronIds,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  isSortieCarrierEnabled,
  isSquadronCarrierEnabled,
  resolveCarrierDisplayName,
} from "../carrier/framework.js";
import { buildCarrierSystemPrompt, composeTier2Request } from "../carrier/prompts.js";

// ─── 타입 ────────────────────────────────────────────────

interface SquadronToolPorts {
  readonly logDebug: (category: string, message: string, options?: unknown) => void;
  readonly enqueueCarrierCompletionPush: (payload: { jobId: string; summary: string }) => void;
}

interface SquadronBackgroundOptions {
  ports: SquadronToolPorts;
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
 * 도구 등록 호출 오너쉽은 fleet/index.ts가 부팅 시 1회 등록합니다.
 * 이 팩토리는 등록 시 필요한 schema/guidelines/execute/render 등
 * 도구 기능 자체만을 제공합니다. 등록 불필요 시 null을 반환합니다.
 */
export function buildSquadronToolSpec(ports: SquadronToolPorts): AgentToolSpec | null {
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
    render: {
      call(args: unknown) {
        const typedArgs = args as { carrier?: string; subtasks?: Array<{ title: string; request: string }> };
        return { carrier: typedArgs.carrier ?? "...", count: typedArgs.subtasks?.length ?? 0 };
      },
    },

    // ── execute: 병렬 job 등록 ──
    async execute(args: unknown, ctx) {
      const t0 = ctx.now();
      const cwd = ctx.cwd;
      const params = args as { carrier: string; expected_subtask_count: number; subtasks: Array<{ title: string; request: string }> };
      const { carrier: carrierId, expected_subtask_count, subtasks } = params;
      ports.logDebug(
        SQUADRON_LOG_CATEGORY_INVOKE,
        `execute start carrier=${carrierId} subtasks=${subtasks.length} ids=${subtasks.map((_, index) => `${index}`).join(", ") || "(none)"}`,
      );

      // 1. 검증
      assertRegisteredCarrier(ports, carrierId);
      assertSortieEnabled(ports, carrierId);
      assertSquadronEnabled(ports, carrierId);
      assertSubtaskCount(ports, expected_subtask_count, subtasks.length);
      assertSubtaskLimit(ports, subtasks.length);
      ports.logDebug(
        SQUADRON_LOG_CATEGORY_VALIDATE,
        `validated carrier=${carrierId} expected=${expected_subtask_count} subtasks=${subtasks.length}`,
      );

      // 1.5. title 새니타이즈 — 경계 마커 인젝션 방지
      const sanitizedSubtasks = sanitizeSquadronSubtasks(subtasks);

      // 2. Tier 2 request 조합 (base 캐리어의 persona 상속)
      const carrierConfig = getRegisteredCarrierConfig(carrierId);
      const composedSubtasks = sanitizedSubtasks.map((st) =>
        carrierConfig?.carrierMetadata
          ? composeTier2Request(carrierConfig.carrierMetadata, st.request)
          : st.request,
      );

      const toolCallId = ctx.toolCallId ?? ``;
      const jobId = buildCarrierJobId("squadron", toolCallId);
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
      const effectiveSignal = ctx.signal
        ? combineAbortSignals([ctx.signal, jobController.signal])
        : jobController.signal;

      // 3. 진행 상태 초기화
      const requestKey = buildSquadronRequestKey(carrierId, sanitizedSubtasks);
      const state = initSquadronState(carrierId, requestKey, sanitizedSubtasks);

      void runSquadronJobInBackground({
        ports,
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

      ports.logDebug(SQUADRON_LOG_CATEGORY_RESULT, `carrier=${carrierId} accepted job=${jobId}`);
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
      trackId: `${opts.jobId}:${index}`,
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
          ports: opts.ports,
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
    results = collectSquadronResults(opts.ports, settledResults, opts.sanitizedSubtasks);
    finalStatus = computeSquadronFinalStatus(results);
    opts.ports.logDebug(
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
    opts.ports.enqueueCarrierCompletionPush({ jobId: opts.jobId, summary: summary.summary });
    unregisterJobAbortControllers(opts.jobId);
    opts.permit.release({ status: finalStatus, error: finalError, finishedAt });
    finalizeJob(opts.jobId, finalStatus === "done" ? "done" : finalStatus === "aborted" ? "aborted" : "error");
    clearSquadronState(opts.requestKey);
    opts.ports.logDebug(SQUADRON_LOG_CATEGORY_INVOKE, `execute end carrier=${opts.carrierId} elapsedMs=${finishedAt - opts.startedAt}`);
  }
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

function assertRegisteredCarrier(ports: SquadronToolPorts, carrierId: string): void {
  const allIds = new Set(getRegisteredOrder());
  if (!allIds.has(carrierId)) {
    const registered = [...allIds].map(formatCarrierIdForMessage).join(", ") || "(none)";
    ports.logDebug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `unknown carrier carrier=${carrierId}`,
    );
    throw new Error(
      `Unknown carrier: ${formatCarrierIdForMessage(carrierId)}. Registered carriers: ${registered}`,
    );
  }
}

function assertSortieEnabled(ports: SquadronToolPorts, carrierId: string): void {
  if (isSortieCarrierEnabled(carrierId)) return;
  ports.logDebug(
    SQUADRON_LOG_CATEGORY_ERROR,
    `carrier=${carrierId} sortieEnabled=false reason=manually disabled`,
  );
  throw new Error(
    `Carrier ${formatCarrierIdForMessage(carrierId)} is not available for squadron: manually disabled.`,
  );
}

function assertSquadronEnabled(ports: SquadronToolPorts, carrierId: string): void {
  if (!isSquadronCarrierEnabled(carrierId)) {
    ports.logDebug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `carrier=${carrierId} squadronEnabled=false`,
    );
    throw new Error(
      `Carrier ${formatCarrierIdForMessage(carrierId)} is not enabled for Squadron.\n` +
      `→ Open Carrier Status (Alt+O), select ${formatCarrierIdForMessage(carrierId)}, press S to enable.`,
    );
  }
}

function assertSubtaskCount(ports: SquadronToolPorts, expected: number, actual: number): void {
  try {
    validateSquadronSubtaskCount(expected, actual);
  } catch (error) {
    ports.logDebug(
      SQUADRON_LOG_CATEGORY_ERROR,
      `subtask count mismatch expected=${expected} actual=${actual}`,
    );
    throw error;
  }
}

function assertSubtaskLimit(ports: SquadronToolPorts, count: number): void {
  try {
    validateSquadronSubtaskLimit(count);
  } catch (error) {
    ports.logDebug(
      SQUADRON_LOG_CATEGORY_ERROR,
      count < 1 ? `subtask count invalid count=${count}` : `subtask count over limit count=${count} max=${SQUADRON_MAX_INSTANCES}`,
    );
    throw error;
  }
}

async function runSquadronInstance(
  index: number,
  title: string,
  request: string,
  opts: {
    ports: SquadronToolPorts;
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
  opts.ports.logDebug(
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
        opts.ports.logDebug(SQUADRON_LOG_CATEGORY_STREAM, `carrier=${opts.carrierId} subtask=${index} type=thought\n${text}`, { hideFromFooter: true });
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
        opts.ports.logDebug(SQUADRON_LOG_CATEGORY_STREAM, `carrier=${opts.carrierId} subtask=${index} type=toolCall title=${sanitizeToolLabel(toolTitle)} status=${sanitizeToolLabel(toolStatus)}`, { hideFromFooter: true });
      },
    });

    progress.status = result.status === "done" ? "done" : "error";
    opts.ports.logDebug(
      SQUADRON_LOG_CATEGORY_EXEC,
      `carrier=${opts.carrierId} subtask=${index} success=${result.status === "done"} status=${result.status} elapsedMs=${Date.now() - execStartedAt}`,
    );
    finalizeSquadronRun(syntheticId, result);
    return buildSquadronResult(index, title, result);
  } catch (error) {
    opts.ports.logDebug(
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
  ports: SquadronToolPorts,
  settledResults: PromiseSettledResult<SquadronResult>[],
  subtasks: Array<{ title: string; request: string }>,
): SquadronResult[] {
  return settledResults.map((settled, index) => {
    if (settled.status === "fulfilled") return settled.value;
    return buildSquadronErrorResult(ports, index, subtasks[index]!.title, settled.reason);
  });
}

function buildSquadronErrorResult(ports: SquadronToolPorts, index: number, title: string, reason: unknown): SquadronResult {
  const errorMessage = sanitizeChunk(
    reason instanceof Error ? reason.message : String(reason),
  );
  ports.logDebug(
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

function sanitizeTitle(text: string): string {
  return sanitizeSquadronTitle(text);
}
