/**
 * taskforce/tool-spec.ts — carrier_taskforce 도구 스펙
 *
 * 선택된 Carrier의 persona를 유지한 채로
 * 선택된 캐리어에 설정된 CLI 백엔드(2개 이상)에 동시 실행하여 교차검증합니다.
 *
 * - execute(): executeOneShot 기반 비세션 병렬 실행
 * - renderCall/renderResult: 고정 요약만 반환하고 실시간 스트리밍은 Agent Panel이 전담
 */

import type { AgentToolSpec } from "../../public/tool-registry-services.js";
import { registerToolPromptManifest } from "../../services/tool-registry/index.js";
import { registerTaskforceJob } from "../bridge/carrier-panel/index.js";
import { getVisibleRun } from "../bridge/run-stream/index.js";
import {
  ANSI_RESET,
  CLI_DISPLAY_NAMES,
  TASKFORCE_BADGE_COLOR,
} from "../../constants.js";
import {
  finalizeDetachedFanoutJob,
  launchResponseResult,
  runDetachedFanoutTrack,
  startDetachedFanoutJob,
  type DetachedFanoutOneShotResult,
  type DetachedFanoutPermit,
} from "../_shared/detached-fanout.js";
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
  computeTaskForceFinalStatus,
  sanitizeTaskForceChunk,
  sanitizeTaskForceToolLabel,
} from "./taskforce-execute.js";
import {
  type BackendProgress,
  type TaskForceCliType,
  type TaskForceResult,
  type TaskForceState,
} from "./types.js";
import type { CarrierJobSummary, CarrierJobStatus } from "../../services/job/index.js";
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
  permit: DetachedFanoutPermit;
  startedAt: number;
}

const TASKFORCE_LOG_CATEGORY_INVOKE = "fleet-taskforce:invoke";
const TASKFORCE_LOG_CATEGORY_VALIDATE = "fleet-taskforce:validate";
const TASKFORCE_LOG_CATEGORY_DISPATCH = "fleet-taskforce:dispatch";
const TASKFORCE_LOG_CATEGORY_STREAM = "fleet-taskforce:stream";
const TASKFORCE_LOG_CATEGORY_EXEC = "fleet-taskforce:exec";
const TASKFORCE_LOG_CATEGORY_RESULT = "fleet-taskforce:result";
const TASKFORCE_LOG_CATEGORY_ERROR = "fleet-taskforce:error";
const TASKFORCE_STATE_KEY = "__pi_carrier_taskforce_state__";

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

      const launch = startDetachedFanoutJob({
        jobKind: "taskforce",
        toolName: "carrier_taskforce",
        toolCallId: ctx.toolCallId,
        startedAt: t0,
        carrierIds: [carrierId],
        signal: ctx.signal,
      });
      if (!launch.accepted) return launch.response;

      // 진행 상태 초기화
      const state = initTaskForceState(carrierId, requestKey, activeBackends);

      void runTaskForceJobInBackground({
        ports,
        jobId: launch.jobId,
        carrierId,
        requestKey,
        activeBackends,
        composedRequest,
        state,
        signal: launch.signal,
        cwd,
        permit: launch.permit,
        startedAt: t0,
      });

      ports.logDebug(TASKFORCE_LOG_CATEGORY_RESULT, `carrier=${carrierId} accepted job=${launch.jobId}`);
      return launchResponseResult({ job_id: launch.jobId, accepted: true });
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
      streamKey: buildTaskForceScopedRunId(opts.requestKey, cliType),
      displayCli: cliType,
      runId: getVisibleRun(buildTaskForceScopedRunId(opts.requestKey, cliType))?.runId,
      displayName: CLI_DISPLAY_NAMES[cliType] ?? cliType,
      subtitle: resolveCarrierDisplayName(opts.carrierId),
      kind: "backend" as const,
    })),
  );
  try {
    const settledResults = await Promise.allSettled(
      opts.activeBackends.map((cliType) =>
        runTaskForceBackend(opts.ports, cliType, opts.carrierId, opts.requestKey, opts.composedRequest, opts.state, opts.signal, opts.cwd, opts.jobId),
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
    finalizeDetachedFanoutJob({
      ports: opts.ports,
      jobId: opts.jobId,
      status: finalStatus,
      error: finalError,
      finishedAt,
      summary,
      permit: opts.permit,
    });
    clearTaskForceState(opts.requestKey);
    opts.ports.logDebug(TASKFORCE_LOG_CATEGORY_INVOKE, `execute end carrier=${opts.carrierId} elapsedMs=${finishedAt - opts.startedAt}`);
  }
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
  requestKey: string,
  request: string,
  state: TaskForceState,
  signal: AbortSignal | undefined,
  cwd: string,
  jobId: string,
): Promise<TaskForceResult> {
  const execStartedAt = Date.now();
  const progress = state.backends.get(cliType)!;

  const syntheticId = buildTaskForceScopedRunId(requestKey, cliType);
  const modelConfig = getRequiredTaskForceModelConfig(carrierId, cliType);

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
    const result = await runDetachedFanoutTrack({
      ports,
      syntheticId,
      cliType,
      request,
      cwd,
      modelConfig,
      signal,
      progress,
      connectSystemPrompt: buildCarrierSystemPrompt(),
      jobId,
      archiveCarrierId: carrierId,
      archiveLabel: cliType,
      sanitizeChunk,
      sanitizeToolLabel,
      onThought: (text) => {
        ports.logDebug(TASKFORCE_LOG_CATEGORY_STREAM, `carrier=${carrierId} backend=${cliType} type=thought\n${text}`, { hideFromFooter: true });
      },
      onToolCall: (title, status) => {
        ports.logDebug(TASKFORCE_LOG_CATEGORY_STREAM, `carrier=${carrierId} backend=${cliType} type=toolCall title=${sanitizeToolLabel(title)} status=${sanitizeToolLabel(status)}`, { hideFromFooter: true });
      },
      buildResult: (result) => result,
    });

    ports.logDebug(
      TASKFORCE_LOG_CATEGORY_EXEC,
      `carrier=${carrierId} backend=${cliType} success=${result.status === "done"} status=${result.status} elapsedMs=${Date.now() - execStartedAt}`,
    );
    return buildTaskForceResult(cliType, result);
  } catch (error) {
    ports.logDebug(
      TASKFORCE_LOG_CATEGORY_EXEC,
      `carrier=${carrierId} backend=${cliType} success=false status=error elapsedMs=${Date.now() - execStartedAt}`,
    );
    throw error;
  }
}

function buildTaskForceResult(
  cliType: TaskForceCliType,
  result: DetachedFanoutOneShotResult,
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

function buildTaskForceScopedRunId(requestKey: string, cliType: TaskForceCliType): string {
  const encodedRequestKey = Buffer.from(requestKey, "utf-8").toString("base64url");
  return `taskforce:${cliType}:${encodedRequestKey}`;
}

function getTaskForceStateStore(): Map<string, TaskForceState> {
  let store = (globalThis as any)[TASKFORCE_STATE_KEY] as Map<string, TaskForceState> | undefined;
  if (!store) {
    store = new Map();
    (globalThis as any)[TASKFORCE_STATE_KEY] = store;
  }
  return store;
}

function initTaskForceState(
  carrierId: string,
  requestKey: string,
  cliTypes: readonly TaskForceCliType[],
): TaskForceState {
  const store = getTaskForceStateStore();
  const state: TaskForceState = {
    carrierId,
    requestKey,
    backends: new Map(
      cliTypes.map((ct) => [ct, { status: "queued", toolCallCount: 0, lineCount: 0 }]),
    ),
    startedAt: Date.now(),
  };
  store.set(requestKey, state);
  return state;
}

function clearTaskForceState(requestKey: string): void {
  const store = getTaskForceStateStore();
  store.delete(requestKey);
}

function sanitizeChunk(text: string): string {
  return sanitizeTaskForceChunk(text);
}

function sanitizeToolLabel(text: string): string {
  return sanitizeTaskForceToolLabel(text);
}
