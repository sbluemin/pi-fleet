/**
 * taskforce/tool-spec.ts — carrier_taskforce 도구 스펙
 *
 * 선택된 Carrier의 persona를 유지한 채로
 * 선택된 캐리어에 설정된 CLI 백엔드(2개 이상)에 동시 실행하여 교차검증합니다.
 *
 * - execute(): executeOneShot 기반 비세션 병렬 실행
 * - renderCall/renderResult: 고정 요약만 반환하고 실시간 스트리밍은 Agent Panel이 전담
 */

import type { AgentToolSpec } from "../public/tool-registry.js";
import { executeOneShot } from "../agent/executor.js";
import { registerToolPromptManifest } from "../admiral/tool-prompt-manifest/index.js";
import { finalizeJob, registerTaskforceJob } from "../bridge/carrier-panel/index.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  finalizeRun,
  updateRunStatus,
  getVisibleRun,
} from "../bridge/run-stream/index.js";
import {
  ANSI_RESET,
  CLI_DISPLAY_NAMES,
  TASKFORCE_BADGE_COLOR,
} from "../constants.js";
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
} from "../job/index.js";
import {
  FLEET_TASKFORCE_DESCRIPTION,
  TASKFORCE_MANIFEST,
  buildTaskForcePromptSnippet,
  buildTaskForcePromptGuidelines,
  buildTaskForceSchema,
} from "./prompts.js";
import {
  assertTaskForceBackendCount,
  buildTaskForceErrorResult as buildCoreTaskForceErrorResult,
  buildTaskForceJobSummary,
  buildTaskForceRequestKey,
  buildTaskForceRunId,
  computeTaskForceFinalStatus,
  sanitizeTaskForceChunk,
  sanitizeTaskForceToolLabel,
} from "./taskforce-execute.js";
import {
  TASKFORCE_STATE_KEY,
  type BackendProgress,
  type TaskForceCliType,
  type TaskForceResult,
  type TaskForceState,
} from "./types.js";
import type { CarrierJobLaunchResponse, CarrierJobSummary, CarrierJobStatus } from "../job/index.js";
import {
  getTaskForceModelConfig,
  getConfiguredTaskForceBackends,
} from "../store/index.js";

import {
  getActiveTaskForceIds,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  isSortieCarrierEnabled,
  resolveCarrierDisplayName,
} from "../carrier/framework.js";
import { buildCarrierSystemPrompt, composeTier2Request } from "../carrier/prompts.js";

// ─── 타입 ────────────────────────────────────────────────

interface TaskForceToolPorts {
  readonly logDebug: (category: string, message: string, options?: unknown) => void;
  readonly enqueueCarrierCompletionPush: (payload: { jobId: string; summary: string }) => void;
}

interface TaskForceBackgroundOptions {
  ports: TaskForceToolPorts;
  jobId: string;
  carrierId: string;
  requestKey: string;
  activeBackends: TaskForceCliType[];
  composedRequest: string;
  state: TaskForceState;
  signal: AbortSignal | undefined;
  cwd: string;
  permit: { release: (finished?: { status?: CarrierJobStatus; error?: string; finishedAt?: number }) => void };
  startedAt: number;
}

const TASKFORCE_LOG_CATEGORY_INVOKE = "fleet-taskforce:invoke";
const TASKFORCE_LOG_CATEGORY_VALIDATE = "fleet-taskforce:validate";
const TASKFORCE_LOG_CATEGORY_DISPATCH = "fleet-taskforce:dispatch";
const TASKFORCE_LOG_CATEGORY_STREAM = "fleet-taskforce:stream";
const TASKFORCE_LOG_CATEGORY_EXEC = "fleet-taskforce:exec";
const TASKFORCE_LOG_CATEGORY_RESULT = "fleet-taskforce:result";
const TASKFORCE_LOG_CATEGORY_ERROR = "fleet-taskforce:error";

// ─── 공개 API ────────────────────────────────────────────

/**
 * carrier_taskforce 도구 정의(ToolDefinition)를 조립해 반환합니다.
 *
 * 도구 등록 호출 오너쉽은 fleet/index.ts가 부팅 시 1회 등록합니다.
 * 이 팩토리는 등록 시 필요한 schema/guidelines/execute/render 등
 * 도구 기능 자체만을 제공합니다. 등록 불필요 시 null을 반환합니다.
 */
export function buildTaskForceToolSpec(ports: TaskForceToolPorts): AgentToolSpec | null {
  const allCarriers = getRegisteredOrder();
  if (allCarriers.length < 1) return null;

  registerToolPromptManifest(TASKFORCE_MANIFEST);

  // TF 편성이 가능한 캐리어만 스키마/가이드라인에 반영
  const configuredCarriers = getActiveTaskForceIds();
  const guidelines = buildTaskForcePromptGuidelines(configuredCarriers);

  return {
    name: "carrier_taskforce",
    label: "Carrier Task Force",
    description: FLEET_TASKFORCE_DESCRIPTION,
    promptSnippet: buildTaskForcePromptSnippet(),
    promptGuidelines: guidelines,
    parameters: buildTaskForceSchema(configuredCarriers),

    // ── renderCall: 고정 1줄 요약 (실시간 스트리밍은 Agent Panel 전담) ──
    render: {
      call(args: unknown) {
        const typedArgs = args as { carrier?: string };
        return typedArgs.carrier ?? "...";
      },
    },

    // ── execute: 활성 백엔드 병렬 job 등록 ──
    async execute(args: unknown, ctx) {
      const t0 = ctx.now();
      const cwd = ctx.cwd;
      const params = args as { carrier: string; request: string };
      const { carrier: carrierId, request } = params;
      const requestKey = buildTaskForceRequestKey(carrierId, request);
      const backendIds = getConfiguredTaskForceBackends(carrierId);
      ports.logDebug(
        TASKFORCE_LOG_CATEGORY_INVOKE,
        `execute start carrier=${carrierId} backends=${backendIds.length} ids=${backendIds.join(", ") || "(none)"}`,
      );

      assertRegisteredCarrier(ports, carrierId);
      assertSortieEnabled(ports, carrierId);
      const activeBackends = assertTaskForceFormable(ports, carrierId);
      ports.logDebug(
        TASKFORCE_LOG_CATEGORY_VALIDATE,
        `validated carrier=${carrierId} backends=${activeBackends.length} ids=${activeBackends.join(", ")}`,
      );
      const composedRequest = buildComposedTaskForceRequest(carrierId, request);

      const toolCallId = ctx.toolCallId ?? ``;
      const jobId = buildCarrierJobId("taskforce", toolCallId);
      const permit = acquireJobPermit({
        jobId,
        tool: "carrier_taskforce",
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

      // 진행 상태 초기화
      const state = initTaskForceState(carrierId, requestKey, activeBackends);

      void runTaskForceJobInBackground({
        ports,
        jobId,
        carrierId,
        requestKey,
        activeBackends,
        composedRequest,
        state,
        signal: effectiveSignal,
        cwd,
        permit,
        startedAt: t0,
      });

      ports.logDebug(TASKFORCE_LOG_CATEGORY_RESULT, `carrier=${carrierId} accepted job=${jobId}`);
      return launchResponseResult({ job_id: jobId, accepted: true });
    },
  };
}

// ─── 내부 상태 관리 ──────────────────────────────────────

async function runTaskForceJobInBackground(opts: TaskForceBackgroundOptions): Promise<void> {
  let finalStatus: CarrierJobStatus = "done";
  let finalError: string | undefined;
  let results: TaskForceResult[] = [];
  registerTaskforceJob(
    opts.jobId,
    opts.carrierId,
    `${opts.activeBackends.length} backends`,
    opts.activeBackends.map((cliType) => ({
      trackId: `${opts.jobId}:${cliType}`,
      streamKey: buildTaskForceRunId(opts.carrierId, cliType),
      displayCli: cliType,
      runId: getVisibleRun(buildTaskForceRunId(opts.carrierId, cliType))?.runId,
      displayName: CLI_DISPLAY_NAMES[cliType] ?? cliType,
      subtitle: resolveCarrierDisplayName(opts.carrierId),
      kind: "backend" as const,
    })),
  );
  try {
    const settledResults = await Promise.allSettled(
      opts.activeBackends.map((cliType) =>
        runTaskForceBackend(opts.ports, cliType, opts.carrierId, opts.composedRequest, opts.state, opts.signal, opts.cwd, opts.jobId),
      ),
    );
    opts.state.finishedAt = Date.now();
    results = collectTaskForceResults(opts.ports, settledResults, opts.activeBackends);
    finalStatus = computeTaskForceFinalStatus(results);
    opts.ports.logDebug(
      TASKFORCE_LOG_CATEGORY_RESULT,
      `carrier=${opts.carrierId} success=${results.filter((r) => r.status === "done").length} failure=${results.filter((r) => r.status !== "done").length}`,
    );
  } catch (error) {
    finalStatus = "error";
    finalError = error instanceof Error ? error.message : String(error);
  } finally {
    const finishedAt = Date.now();
    const summary = buildTaskForceJobSummary(opts.jobId, opts.startedAt, finishedAt, opts.carrierId, results, finalStatus, finalError);
    putJobSummary(summary, finishedAt);
    finalizeJobArchive(opts.jobId, finalStatus, finishedAt);
    opts.ports.enqueueCarrierCompletionPush({ jobId: opts.jobId, summary: summary.summary });
    unregisterJobAbortControllers(opts.jobId);
    opts.permit.release({ status: finalStatus, error: finalError, finishedAt });
    finalizeJob(opts.jobId, finalStatus === "done" ? "done" : finalStatus === "aborted" ? "aborted" : "error");
    clearTaskForceState(opts.requestKey);
    opts.ports.logDebug(TASKFORCE_LOG_CATEGORY_INVOKE, `execute end carrier=${opts.carrierId} elapsedMs=${finishedAt - opts.startedAt}`);
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

function assertRegisteredCarrier(ports: TaskForceToolPorts, carrierId: string): void {
  const allIds = new Set(getRegisteredOrder());
  if (!allIds.has(carrierId)) {
    const registered = [...allIds].map(formatCarrierIdForMessage).join(", ") || "(none)";
    ports.logDebug(
      TASKFORCE_LOG_CATEGORY_ERROR,
      `unknown carrier carrier=${carrierId}`,
    );
    throw new Error(
      `Unknown carrier: ${formatCarrierIdForMessage(carrierId)}. Registered carriers: ${registered}`,
    );
  }
}

function assertSortieEnabled(ports: TaskForceToolPorts, carrierId: string): void {
  if (isSortieCarrierEnabled(carrierId)) return;
  ports.logDebug(
    TASKFORCE_LOG_CATEGORY_ERROR,
    `carrier=${carrierId} sortieEnabled=false reason=manually disabled`,
  );
  throw new Error(
    `Carrier ${formatCarrierIdForMessage(carrierId)} is not available for task force: manually disabled.`,
  );
}

function assertTaskForceFormable(ports: TaskForceToolPorts, carrierId: string): TaskForceCliType[] {
  const activeBackends = getConfiguredTaskForceBackends(carrierId);
  try {
    return [...assertTaskForceBackendCount(carrierId, activeBackends)] as TaskForceCliType[];
  } catch (error) {
    ports.logDebug(
      TASKFORCE_LOG_CATEGORY_ERROR,
      `carrier=${carrierId} insufficient backends=${activeBackends.length}`,
    );
    throw error;
  }
}

function buildComposedTaskForceRequest(carrierId: string, request: string): string {
  const carrierConfig = getRegisteredCarrierConfig(carrierId);
  return carrierConfig?.carrierMetadata
    ? composeTier2Request(carrierConfig.carrierMetadata, request)
    : request;
}

function getRequiredTaskForceModelConfig(
  carrierId: string,
  cliType: TaskForceCliType,
): NonNullable<ReturnType<typeof getTaskForceModelConfig>> {
  const modelConfig = getTaskForceModelConfig(carrierId, cliType);
  if (modelConfig) return modelConfig;
  throw new Error(`Task Force config missing for ${cliType} on carrier "${carrierId}".`);
}

async function runTaskForceBackend(
  ports: TaskForceToolPorts,
  cliType: TaskForceCliType,
  carrierId: string,
  request: string,
  state: TaskForceState,
  signal: AbortSignal | undefined,
  cwd: string,
  jobId: string,
): Promise<TaskForceResult> {
  const execStartedAt = Date.now();
  const progress = state.backends.get(cliType)!;
  progress.status = "connecting";

  const syntheticId = buildTaskForceRunId(carrierId, cliType);
  const modelConfig = getRequiredTaskForceModelConfig(carrierId, cliType);

  // synthetic run은 동일 키로 재사용하여 반복 실행 누적을 방지합니다.
  prepareTaskForceRun(syntheticId);
  ports.logDebug(
    TASKFORCE_LOG_CATEGORY_DISPATCH,
    [
      `carrier=${carrierId} backend=${cliType} model=${modelConfig.model ?? cliType} promptChars=${request.length} run=${syntheticId}`,
      "----- BEGIN REQUEST -----",
      request,
      "----- END REQUEST -----",
    ].join("\n"),
    { hideFromFooter: true, category: "prompt" },
  );

  try {
    const result = await executeOneShot({
      carrierId: syntheticId,
      cliType,
      request,
      cwd,
      model: modelConfig.model,
      effort: modelConfig.effort,
      budgetTokens: modelConfig.budgetTokens,
      connectSystemPrompt: buildCarrierSystemPrompt(),
      signal,
      onStatusChange: (status) => {
        updateRunStatus(syntheticId, status);
      },
      onMessageChunk: (text: string) => {
        progress.status = "streaming";
        progress.lineCount++;
        appendTextBlock(syntheticId, sanitizeChunk(text));
        appendBlock(jobId, toMessageArchiveBlock(carrierId, text, cliType));
      },
      onThoughtChunk: (text: string) => {
        appendThoughtBlock(syntheticId, sanitizeChunk(text));
        appendBlock(jobId, toThoughtArchiveBlock(carrierId, text, cliType));
        ports.logDebug(TASKFORCE_LOG_CATEGORY_STREAM, `carrier=${carrierId} backend=${cliType} type=thought\n${text}`, { hideFromFooter: true });
      },
      onToolCall: (title: string, status: string, _rawOutput?: string, toolCallId?: string) => {
        progress.status = "streaming";
        progress.toolCallCount++;
        upsertToolBlock(
          syntheticId,
          sanitizeToolLabel(title),
          sanitizeToolLabel(status),
          toolCallId,
        );
        ports.logDebug(TASKFORCE_LOG_CATEGORY_STREAM, `carrier=${carrierId} backend=${cliType} type=toolCall title=${sanitizeToolLabel(title)} status=${sanitizeToolLabel(status)}`, { hideFromFooter: true });
      },
    });

    progress.status = result.status === "done" ? "done" : "error";
    ports.logDebug(
      TASKFORCE_LOG_CATEGORY_EXEC,
      `carrier=${carrierId} backend=${cliType} success=${result.status === "done"} status=${result.status} elapsedMs=${Date.now() - execStartedAt}`,
    );
    finalizeTaskForceRun(syntheticId, result);
    return buildTaskForceResult(cliType, result);
  } catch (error) {
    ports.logDebug(
      TASKFORCE_LOG_CATEGORY_EXEC,
      `carrier=${carrierId} backend=${cliType} success=false status=error elapsedMs=${Date.now() - execStartedAt}`,
    );
    throw error;
  }
}

function finalizeTaskForceRun(syntheticId: string, result: Awaited<ReturnType<typeof executeOneShot>>): void {
  finalizeRun(syntheticId, result.status === "done" ? "done" : "err", {
    error: result.error,
    fallbackText: sanitizeChunk(result.responseText),
    fallbackThinking: sanitizeChunk(result.thoughtText),
  });

  // TODO: stream-store에 synthetic run 정리 API가 없으므로 run은 store에 잔류합니다.
  // stream-store에 deleteRun/removeRun API 추가 시 여기서 cleanup하세요.
}

function buildTaskForceResult(
  cliType: TaskForceCliType,
  result: Awaited<ReturnType<typeof executeOneShot>>,
): TaskForceResult {
  return {
    cliType,
    displayName: CLI_DISPLAY_NAMES[cliType] ?? cliType,
    status: result.status as "done" | "error" | "aborted",
    responseText: sanitizeChunk(result.responseText) || "(no output)",
    error: result.error ? sanitizeChunk(result.error) : undefined,
    thinking: result.thoughtText ? sanitizeChunk(result.thoughtText) : undefined,
    toolCalls: result.toolCalls.map((toolCall) => ({
      title: sanitizeToolLabel(toolCall.title),
      status: sanitizeToolLabel(toolCall.status),
    })),
  };
}

function collectTaskForceResults(
  ports: TaskForceToolPorts,
  settledResults: PromiseSettledResult<TaskForceResult>[],
  activeBackends: readonly TaskForceCliType[],
): TaskForceResult[] {
  return settledResults.map((settled, index) => {
    if (settled.status === "fulfilled") return settled.value;
    return buildTaskForceErrorResult(
      ports,
      activeBackends[index]!,
      settled.reason,
    );
  });
}

function buildTaskForceErrorResult(ports: TaskForceToolPorts, cliType: TaskForceCliType, reason: unknown): TaskForceResult {
  const result = buildCoreTaskForceErrorResult(cliType, reason);
  ports.logDebug(
    TASKFORCE_LOG_CATEGORY_ERROR,
    `backend=${cliType} message=${result.error ?? ""}`,
  );
  return result;
}

function getTaskForceState(): TaskForceState | null {
  return (globalThis as any)[TASKFORCE_STATE_KEY] ?? null;
}

function initTaskForceState(
  carrierId: string,
  requestKey: string,
  cliTypes: readonly TaskForceCliType[],
): TaskForceState {
  const state: TaskForceState = {
    carrierId,
    requestKey,
    backends: new Map(
      cliTypes.map((ct) => [ct, { status: "queued", toolCallCount: 0, lineCount: 0 }]),
    ),
    startedAt: Date.now(),
  };
  (globalThis as any)[TASKFORCE_STATE_KEY] = state;
  return state;
}

function clearTaskForceState(requestKey?: string): void {
  const state = getTaskForceState();
  if (requestKey && state?.requestKey !== requestKey) return;
  (globalThis as any)[TASKFORCE_STATE_KEY] = null;
}

function prepareTaskForceRun(syntheticId: string): void {
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
  return sanitizeTaskForceChunk(text);
}

function sanitizeToolLabel(text: string): string {
  return sanitizeTaskForceToolLabel(text);
}
