/**
 * fleet/carrier/sortie.ts — Carrier Sortie 도구 등록
 *
 * carrier 위임의 유일한 PI 도구입니다.
 * 1개 이상 Carrier에 작업을 위임(출격)할 때 사용합니다.
 *
 * [호출 인스턴스 격리 설계]
 * 1. 상태 격리: PI가 부여한 `id`(toolCallId)를 `sortieKey`로 사용하여 `globalThis`의 Map 기반 저장소에서
 *    각 호출별 상태(SortieState)를 독립적으로 관리합니다. 이를 통해 동시/연속 호출 시 UI 간섭을 방지합니다.
 * 2. 컴포넌트 바인딩: `SortieCallComponent`는 최초 렌더링 시 args 매칭을 통해 활성 state의 `sortieKey`를
 *    고정(bind)하며, 이후에는 해당 key를 통해서만 상태와 결과 캐시를 참조합니다.
 * 3. 스트리밍 격리: 각 Carrier가 실행될 때 첫 청크 시점의 `runId`를 캡처하여 `SortieState.runIds`에 저장합니다.
 *    렌더러는 이 고정된 `runId`를 통해 해당 호출에 속한 스트리밍 콘텐츠만 필터링하여 표시합니다.
 * 4. 결과 캐시: 최종 결과는 `sortieKey`별로 LRU 캐시에 저장되어, 세션 리로드나 히스토리 복원 시에도
 *    정확한 과거 실행 결과를 재현합니다.
 *
 * renderCall에서 스트리밍 콘텐츠 + 진행 상태 + 최종 결과까지 트리 형태로 통합 표시하며,
 * renderResult는 빈 컴포넌트를 반환하여 중복 표시를 방지합니다.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { getLogAPI } from "../../../core/log/bridge.js";
import { registerToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import { runAgentRequestBackground } from "../../operation-runner.js";
import { toMessageArchiveBlock, toThoughtArchiveBlock } from "../_shared/archive-block-converter.js";
import { acquireJobPermit } from "../_shared/concurrency-guard.js";
import { registerJobAbortController, unregisterJobAbortControllers } from "../_shared/job-cancel-registry.js";
import { buildCarrierJobId } from "../_shared/job-id.js";
import { formatLaunchResponseText } from "../_shared/job-reminders.js";
import { appendBlock, createJobArchive, finalizeJobArchive } from "../_shared/job-stream-archive.js";
import type { CarrierJobLaunchResponse, CarrierJobSummary, CarrierJobStatus } from "../_shared/job-types.js";
import { putJobSummary } from "../_shared/lru-cache.js";
import { enqueueCarrierCompletionPush } from "../_shared/push.js";
import { composeTier2Request } from "./prompts.js";
import { getVisibleRun, getRunById } from "../../bridge/streaming/stream-store.js";
import { renderBlockLines, blockLineToAnsi } from "../../bridge/render/block-renderer.js";
import {
  getRegisteredOrder,
  getSortieEnabledIds,
  isSortieCarrierEnabled,
  isSquadronCarrierEnabled,
  resolveCarrierColor,
  resolveCarrierDisplayName,
  getRegisteredCarrierConfig,
} from "./framework.js";
import {
  ANSI_RESET,
  PANEL_COLOR,
  PANEL_DIM_COLOR,
  SPINNER_FRAMES,
  SYM_INDICATOR,
} from "../../constants.js";
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
interface CarrierSortieResult {
  carrierId: string;
  displayName: string;
  status: "done" | "error" | "aborted";
  responseText: string;
  sessionId?: string;
  error?: string;
  thinking?: string;
  toolCalls?: { title: string; status: string }[];
}

/** carriers_sortie 도구 결과 details */
interface SortieResultDetails {
  sortieKey: string;
  results: CarrierSortieResult[];
  /** 총 경과시간 (ms) — 히스토리 복원 시 표시용 */
  elapsedMs?: number;
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

/** renderCall에서 사용하는 최소 컨텍스트 */
interface SortieRenderContext {
  invalidate?: () => void;
  lastComponent?: unknown;
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
  /** args 기반 키 (renderCall → state 초기 매칭용) */
  argsKey: string;
  /** carrierId → 진행 상태 */
  carriers: Map<string, CarrierProgress>;
  /** carrierId → stream-store runId (스트리밍 콘텐츠 격리용) */
  runIds: Map<string, string>;
  /** 애니메이션 프레임 카운터 */
  frame: number;
  /** 프레임 타이머 */
  timer: ReturnType<typeof setInterval> | null;
  /** 실행 시작 시각 (Date.now()) */
  startedAt: number;
  /** 모든 작업 완료 시각 */
  finishedAt?: number;
}

// ─── 경과시간 포맷팅 ────────────────────────────────────────

/** 밀리초를 사람이 읽기 쉬운 경과시간 문자열로 변환 */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${String(sec).padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${String(remMin).padStart(2, "0")}m`;
}

// ─── 상수 ────────────────────────────────────────────────

/** Carrier당 최대 콘텐츠 라인 수 (tail 방식으로 최근 N줄만 표시) */
const MAX_CONTENT_LINES = 6;

/** 히스토리 복원용 결과 캐시 최대 보관 수 */
const MAX_RESULT_CACHE_ENTRIES = 50;

/** globalThis 진행 상태 키 (renderCall에서 참조) */
const SORTIE_STATE_KEY = "__pi_carrier_sortie_state__";

/** 히스토리 복원용 결과 캐시 키 */
const SORTIE_RESULT_CACHE_KEY = "__pi_carrier_sortie_result_cache__";

const SORTIE_LOG_CATEGORY_INVOKE = "fleet-sortie:invoke";
const SORTIE_LOG_CATEGORY_VALIDATE = "fleet-sortie:validate";
const SORTIE_LOG_CATEGORY_DISPATCH = "fleet-sortie:dispatch";
const SORTIE_LOG_CATEGORY_STREAM = "fleet-sortie:stream";
const SORTIE_LOG_CATEGORY_EXEC = "fleet-sortie:exec";
const SORTIE_LOG_CATEGORY_RESULT = "fleet-sortie:result";
const SORTIE_LOG_CATEGORY_ERROR = "fleet-sortie:error";

// ─── 공개 API ────────────────────────────────────────────

/**
 * carriers_sortie 도구 정의(ToolDefinition)를 조립해 반환합니다.
 *
 * pi.registerTool 호출 오너쉽은 fleet/index.ts가 부팅 시 1회 등록합니다.
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

    // ── renderCall: 스트리밍 콘텐츠 + 최종 결과까지 통합 표시 ──
    renderCall(args: unknown, theme: Theme, context: any) {
      const typedArgs = args as { carriers?: CarrierAssignment[] };
      const entries = typedArgs.carriers ?? [];
      const component = context?.lastComponent instanceof SortieCallComponent
        ? context.lastComponent
        : new SortieCallComponent();
      component.setState(entries, theme, context);
      return component;
    },

    // ── renderResult: 빈 컴포넌트 (renderCall이 모든 것을 표시) ──
    // 히스토리 복원용으로 결과를 globalThis 캐시에 저장
    renderResult(result: any, _options: { expanded: boolean; isPartial: boolean }, _theme: any) {
      const details = result.details as SortieResultDetails | undefined;
      if (details?.results && details.sortieKey) {
        setResultCache(details.sortieKey, details.results, details.elapsedMs);
      }
      // 빈 컴포넌트 — renderCall이 모든 상태를 통합 표시
      return { render() { return []; }, invalidate() {} };
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
      if (!assignments || assignments.length < 1) {
        getLogAPI().debug(
          SORTIE_LOG_CATEGORY_ERROR,
          `execute invalid carriers=0`,
        );
        throw new Error("carriers_sortie requires at least 1 carrier assignment.");
      }

      // expected_carrier_count 일치 검증 — 선언한 수와 실제 배열 길이 불일치 시 hard error
      const expectedCount = params.expected_carrier_count;
      if (expectedCount !== assignments.length) {
        getLogAPI().debug(
          SORTIE_LOG_CATEGORY_ERROR,
          `count mismatch expected=${expectedCount} actual=${assignments.length}`,
        );
        throw new Error(
          `Carrier count mismatch: expected_carrier_count is ${expectedCount} but carriers array has ${assignments.length} entr${assignments.length === 1 ? "y" : "ies"}.` +
          ` Add all ${expectedCount} carrier${expectedCount === 1 ? "" : "s"} to the carriers array and resubmit as a single call.`,
        );
      }

      // Carrier ID 유효성 검증
      const allIds = new Set(getRegisteredOrder());
      const enabledIds = new Set(getSortieEnabledIds());
      for (const a of assignments) {
        if (!allIds.has(a.carrier)) {
          getLogAPI().debug(
            SORTIE_LOG_CATEGORY_ERROR,
            `unknown carrier carrier=${a.carrier}`,
          );
          // 미등록 carrier — 등록된 전체 목록을 표시하여 LLM이 올바른 ID를 파악하도록 함
          const registered = [...allIds].join(", ") || "(none)";
          throw new Error(`Unknown carrier: "${a.carrier}". Registered carriers: ${registered}`);
        }
        // sortie 비활성 carrier 가드 — throw 대신 content로 에러 반환하여 LLM이 재시도 가능
        // 사유를 구체적으로 전달하여 LLM이 적절한 대안을 선택하도록 유도
        if (!enabledIds.has(a.carrier)) {
          const reason = isSquadronCarrierEnabled(a.carrier)
            ? "assigned to squadron (use carrier_squadron instead)"
            : !isSortieCarrierEnabled(a.carrier)
              ? "manually disabled"
              : "unavailable";
          const available = [...enabledIds].join(", ") || "(none)";
          getLogAPI().debug(
            SORTIE_LOG_CATEGORY_ERROR,
            `carrier unavailable carrier=${a.carrier} reason=${reason}`,
          );
          const jobId = buildCarrierJobId("sortie", id);
          return launchResponseResult({
            job_id: jobId,
            accepted: false,
            error: `Carrier "${a.carrier}" is not available for sortie: ${reason}. Available carriers: ${available}`,
          });
        }
      }

      const jobId = buildCarrierJobId("sortie", id);

      // 중복 carrier 검증
      const seen = new Set<string>();
      for (const a of assignments) {
        if (seen.has(a.carrier)) {
          getLogAPI().debug(
            SORTIE_LOG_CATEGORY_ERROR,
            `duplicate carrier carrier=${a.carrier}`,
          );
          throw new Error(`Duplicate carrier: "${a.carrier}". Each carrier can only be assigned once.`);
        }
        seen.add(a.carrier);
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
        ? AbortSignal.any([signal, jobController.signal])
        : jobController.signal;

      // 진행 상태 초기화 (id = PI tool call ID로 호출 인스턴스를 고유 식별)
      const sortieKey = id;
      const argsKey = buildArgsKey(assignments);
      const state = initSortieState(sortieKey, argsKey, assignments.map((a) => a.carrier));

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
    finalStatus = computeFinalStatus(results);
    const elapsedMs = opts.state.finishedAt - opts.state.startedAt;
    setResultCache(opts.sortieKey, results, elapsedMs);
    getLogAPI().debug(
      SORTIE_LOG_CATEGORY_RESULT,
      `run=${opts.sortieKey} success=${results.filter((r) => r.status === "done").length} failure=${results.filter((r) => r.status !== "done").length} cacheSaved=true`,
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
    clearSortieState(opts.sortieKey);
    getLogAPI().debug(SORTIE_LOG_CATEGORY_INVOKE, `execute end elapsedMs=${finishedAt - opts.startedAt}`);
  }
}

function computeFinalStatus(results: CarrierSortieResult[]): CarrierJobStatus {
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
      },
      onThoughtChunk: (text: string) => {
        appendBlock(opts.jobId, toThoughtArchiveBlock(assignment.carrier, text));
      },
      onToolCall: (toolTitle: string, toolStatus: string, _rawOutput?: string, _toolCallId?: string) => {
        progress.status = "streaming";
        progress.toolCallCount++;
        captureSortieRunId(opts.state, assignment.carrier);
        getLogAPI().debug(SORTIE_LOG_CATEGORY_STREAM, `carrier=${assignment.carrier} type=toolCall title=${toolTitle} status=${toolStatus}`, { hideFromFooter: true });
      },
    });
    progress.status = result.status === "done" ? "done" : "error";
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
    getLogAPI().debug(SORTIE_LOG_CATEGORY_EXEC, `carrier=${assignment.carrier} success=false status=error elapsedMs=${Date.now() - execStartedAt}`);
    throw error;
  }
}

function captureSortieRunId(state: SortieState, carrierId: string): void {
  if (state.runIds.has(carrierId)) return;
  const run = getVisibleRun(carrierId);
  if (run) state.runIds.set(carrierId, run.runId);
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

function buildSortieJobSummary(
  jobId: string,
  startedAt: number,
  finishedAt: number,
  assignments: CarrierAssignment[],
  results: CarrierSortieResult[],
  status: CarrierJobStatus,
  error?: string,
): CarrierJobSummary {
  const successCount = results.filter((result) => result.status === "done").length;
  const failureCount = results.length - successCount;
  return {
    jobId,
    tool: "carriers_sortie",
    status,
    summary: buildSortieSummaryText(status, successCount, failureCount, error),
    startedAt,
    finishedAt,
    carriers: assignments.map((assignment) => assignment.carrier),
    error,
  };
}

function buildSortieSummaryText(status: CarrierJobStatus, successCount: number, failureCount: number, error?: string): string {
  if (status === "aborted") return `carriers_sortie aborted: ${successCount} done, ${failureCount} failed`;
  if (error) return `carriers_sortie failed: ${error}`;
  return `carriers_sortie completed: ${successCount} done, ${failureCount} failed`;
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

/** sortieKey(toolCallId)로 state를 직접 조회 */
function getSortieState(sortieKey: string): SortieState | null {
  return getStateStore().get(sortieKey) ?? null;
}

/** argsKey로 활성 state를 검색 (renderCall → state 초기 매칭용) */
function findActiveSortieStateByArgsKey(argsKey: string): SortieState | null {
  for (const state of getStateStore().values()) {
    if (state.argsKey === argsKey) return state;
  }
  return null;
}

function initSortieState(sortieKey: string, argsKey: string, carrierIds: string[]): SortieState {
  const store = getStateStore();
  // 동일 key state가 이미 있으면 타이머 정리 후 교체
  const existing = store.get(sortieKey);
  if (existing?.timer) clearInterval(existing.timer);

  const state: SortieState = {
    sortieKey,
    argsKey,
    carriers: new Map(
      carrierIds.map((id) => [id, { status: "queued", toolCallCount: 0, lineCount: 0 }]),
    ),
    runIds: new Map(),
    frame: 0,
    timer: null,
    startedAt: Date.now(),
  };
  // 애니메이션 프레임 카운터 (100ms)
  state.timer = setInterval(() => { state.frame++; }, 100);
  store.set(sortieKey, state);
  return state;
}

function clearSortieState(sortieKey: string): void {
  const store = getStateStore();
  const state = store.get(sortieKey);
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  store.delete(sortieKey);
}

// ─── Result Cache Store (Map<sortieKey, results> + LRU) ──

/** 결과 캐시 엔트리 (결과 + 경과시간) */
interface SortieResultCacheEntry {
  results: CarrierSortieResult[];
  elapsedMs?: number;
}

/** 결과 캐시 스토어 (sortieKey → entry) */
function getResultCacheStore(): Map<string, SortieResultCacheEntry> {
  let store = (globalThis as any)[SORTIE_RESULT_CACHE_KEY] as Map<string, SortieResultCacheEntry> | undefined;
  if (!store) {
    store = new Map();
    (globalThis as any)[SORTIE_RESULT_CACHE_KEY] = store;
  }
  return store;
}

/** 결과 캐시 저장 (renderResult → renderCall 히스토리 복원용) */
function setResultCache(sortieKey: string, results: CarrierSortieResult[], elapsedMs?: number): void {
  const store = getResultCacheStore();
  store.delete(sortieKey);
  store.set(sortieKey, { results, elapsedMs });
  // LRU: 최대 엔트리 초과 시 가장 오래된 항목 제거
  while (store.size > MAX_RESULT_CACHE_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}

/** 결과 캐시 읽기 */
function getResultCache(sortieKey: string): SortieResultCacheEntry | null {
  return getResultCacheStore().get(sortieKey) ?? null;
}

/** args 기반 키 생성 (renderCall에서 state 초기 매칭용) */
function buildArgsKey(assignments: CarrierAssignment[]): string {
  const parts = assignments.map((a) => [a.carrier, (a.request || "").replace(/\r\n?/g, "\n").trim()]);
  return JSON.stringify(parts);
}

/**
 * carriers_sortie의 renderCall 전용 컴포넌트입니다.
 * 동일 인스턴스를 재사용해 렌더 상태를 유지하고,
 * 완료 직후 한 프레임 동안만 이전 높이를 보존해 compact 전환을 안정화합니다.
 */
class SortieCallComponent {
  private entries: CarrierAssignment[] = [];
  /** args 기반 키 (활성 state 초기 매칭용) */
  private argsKey = "";
  /** PI tool call ID (바인딩 후 state·캐시 직접 참조용) */
  private sortieKey = "";
  private theme: any = null;
  private context: SortieRenderContext | undefined;
  private lastRenderedLineCount = 0;
  private compactCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private compactCleanupPending = false;

  setState(
    entries: CarrierAssignment[],
    theme: any,
    context: SortieRenderContext | undefined,
  ): void {
    this.entries = entries;
    this.argsKey = buildArgsKey(entries);
    this.theme = theme;
    this.context = context;
  }

  invalidate(): void {
    if (this.compactCleanupTimer) {
      clearTimeout(this.compactCleanupTimer);
      this.compactCleanupTimer = null;
    }
    this.compactCleanupPending = false;
  }

  render(width: number): string[] {
    const lines = this.buildLines(width);
    const nextLineCount = lines.length;
    // 캐리어별 완료 시 즉시 빈 줄 패딩 — 스트리밍 중이라도 줄 감소 시 정리
    const needsCompactCleanup =
      this.lastRenderedLineCount > nextLineCount &&
      !this.compactCleanupPending;

    if (needsCompactCleanup) {
      const padded = [...lines];
      for (let i = nextLineCount; i < this.lastRenderedLineCount; i++) {
        padded.push(" ".repeat(width));
      }
      this.scheduleCompactCleanup(nextLineCount);
      this.lastRenderedLineCount = padded.length;
      return padded;
    }

    this.lastRenderedLineCount = nextLineCount;
    return lines;
  }

  private scheduleCompactCleanup(compactLineCount: number): void {
    if (this.compactCleanupTimer) clearTimeout(this.compactCleanupTimer);
    this.compactCleanupPending = true;
    this.compactCleanupTimer = setTimeout(() => {
      this.compactCleanupTimer = null;
      this.compactCleanupPending = false;
      this.lastRenderedLineCount = compactLineCount;
      this.context?.invalidate?.();
    }, 0);
  }

  private buildLines(width: number): string[] {
    // 터미널 실제 너비로 제한 — width가 터미널보다 크면 wrap으로 height 불일치 발생
    const termCols = process.stdout.columns || 80;
    const effectiveWidth = Math.min(width, termCols);
    // sortieKey가 이미 바인딩된 컴포넌트는 재바인딩하지 않습니다.
    let state: SortieState | null = null;
    if (this.sortieKey) {
      state = getSortieState(this.sortieKey);
    } else {
      const found = findActiveSortieStateByArgsKey(this.argsKey);
      if (found) {
        this.sortieKey = found.sortieKey; // toolCallId 바인딩
        state = found;
      }
    }
    const cachedEntry = this.sortieKey ? getResultCache(this.sortieKey) : null;
    const cachedResults = cachedEntry?.results ?? null;
    const frame = state?.frame ?? 0;
    const count = this.entries.length;
    const lines: string[] = [];

    // ── 경과시간 계산 ──
    let elapsedSuffix = "";
    if (state) {
      const elapsed = state.finishedAt
        ? state.finishedAt - state.startedAt
        : Date.now() - state.startedAt;
      elapsedSuffix = this.theme.fg("dim", ` · ${formatElapsed(elapsed)}`);
    } else if (cachedEntry?.elapsedMs != null) {
      elapsedSuffix = this.theme.fg("dim", ` · ${formatElapsed(cachedEntry.elapsedMs)}`);
    }

    // ── 헤더: 진행 상태 요약 ──
    const headerTitle = this.theme.fg("toolTitle", this.theme.bold("◈ Carriers Sortie"));
    let headerSuffix: string;
    if (state) {
      const doneCount = [...state.carriers.values()].filter((p) => p.status === "done").length;
      const errorCount = [...state.carriers.values()].filter((p) => p.status === "error").length;
      const runningCount = count - doneCount - errorCount;
      const parts: string[] = [`${count} carriers`];
      if (runningCount > 0) parts.push(`${runningCount} running`);
      if (doneCount > 0) parts.push(`${doneCount} done`);
      if (errorCount > 0) parts.push(`${errorCount} err`);
      headerSuffix = parts.join(", ");
    } else if (cachedResults) {
      const doneCount = cachedResults.filter((r) => r.status === "done").length;
      const errorCount = cachedResults.filter((r) => r.status !== "done").length;
      const parts: string[] = [`${cachedResults.length} carriers`];
      if (doneCount > 0) parts.push(`${doneCount} done`);
      if (errorCount > 0) parts.push(`${errorCount} error`);
      headerSuffix = parts.join(", ");
    } else {
      headerSuffix = `${count} carriers launched`;
    }
    lines.push(`${headerTitle} ${this.theme.fg("dim", `· ${headerSuffix}`)}${elapsedSuffix}`);

    // ── 각 Carrier 트리 노드 + 하위 콘텐츠 ──
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry) continue;
      const isLast = i === this.entries.length - 1;
      const treePrefix = isLast ? "└─" : "├─";
      const connector = isLast ? "   " : "│  ";

      const carrierId = entry.carrier ?? "";
      const displayName = carrierId ? resolveCarrierDisplayName(carrierId) : "...";
      const color = carrierId ? (resolveCarrierColor(carrierId) || PANEL_COLOR) : PANEL_DIM_COLOR;
      const progress = carrierId ? state?.carriers.get(carrierId) : undefined;
      const cachedResult = cachedResults?.find((r) => r.carrierId === carrierId);

      let icon: string;
      if (progress) {
        icon = statusIcon(progress.status, frame, carrierId);
      } else if (cachedResult) {
        icon = resultIcon(cachedResult.status);
      } else {
        icon = `${PANEL_DIM_COLOR}○${ANSI_RESET}`;
      }

      const summary = entry.request
        ? truncateToWidth(
            summarizeRequest(entry.request),
            Math.max(0, effectiveWidth - 20 - visibleWidth(displayName)),
          )
        : "";
      const pText = progress ? progressText(progress) : "";
      const progressSuffix = pText
        ? ` ${PANEL_DIM_COLOR}[${pText}]${ANSI_RESET}`
        : "";

      lines.push(
        `  ${PANEL_DIM_COLOR}${treePrefix}${ANSI_RESET} ${icon} ${color}${displayName}${ANSI_RESET}` +
        (summary ? ` ${this.theme.fg("dim", `· ${summary}`)}` : "") + progressSuffix,
      );

      const isStreaming = progress && (progress.status === "connecting" || progress.status === "streaming");
      if (carrierId && isStreaming) {
        const runId = state?.runIds.get(carrierId);
        const contentLines = renderCarrierContentLines(carrierId, runId, connector, effectiveWidth, this.theme);
        for (const cl of contentLines) {
          lines.push(cl);
        }
      }
    }

    return lines.map((line) => visibleWidth(line) > effectiveWidth ? truncateToWidth(line, effectiveWidth) : line);
  }
}

/** 진행 상태에 따른 아이콘 반환 */
function statusIcon(status: CarrierProgress["status"], frame: number, carrierId: string): string {
  const color = resolveCarrierColor(carrierId) || PANEL_COLOR;
  switch (status) {
    case "queued":
      return `${PANEL_DIM_COLOR}○${ANSI_RESET}`;
    case "connecting":
    case "streaming":
      return `${color}${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}${ANSI_RESET}`;
    case "done":
      return `\x1b[38;2;100;200;100m${SYM_INDICATOR}${ANSI_RESET}`;
    case "error":
      return `\x1b[38;2;255;80;80m${SYM_INDICATOR}${ANSI_RESET}`;
  }
}

/** 최종 결과 아이콘 */
function resultIcon(status: string): string {
  if (status === "done") return `\x1b[38;2;100;200;100m${SYM_INDICATOR}${ANSI_RESET}`;
  return `\x1b[38;2;255;80;80m${SYM_INDICATOR}${ANSI_RESET}`;
}

/** 진행 상태의 간략 텍스트 */
function progressText(p: CarrierProgress): string {
  const parts: string[] = [];
  if (p.toolCallCount > 0) parts.push(`${p.toolCallCount}T`);
  if (p.lineCount > 0) parts.push(`${p.lineCount}L`);
  return parts.length > 0 ? parts.join("·") : "";
}

/** 요청 원문에서 한 줄 작전 요약을 추출합니다. */
function summarizeRequest(request: string | undefined): string {
  if (!request) return "Awaiting orders";
  const normalized = request
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[•·▪◦▶▸→⇒-]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "Awaiting orders";

  const noLead = normalized
    .replace(/^(please|kindly|can you|could you|would you|let'?s|pls)\s+/i, "")
    .replace(/^(분석해줘|분석해주세요|구현해줘|구현해주세요|수정해줘|수정해주세요|검토해줘|검토해주세요|정리해줘|정리해주세요)\s*/u, "")
    .trim();

  return (noLead || normalized).replace(/[.?!。！？]+$/u, "").trim() || "Awaiting orders";
}

/**
 * 특정 Carrier의 스트리밍 콘텐츠 라인을 생성합니다.
 * stream-store의 블록 데이터를 읽어 MAX_CONTENT_LINES만큼 tail 표시합니다.
 */
function renderCarrierContentLines(
  carrierId: string,
  runId: string | undefined,
  connector: string,
  contentWidth: number,
  _theme: any,
): string[] {
  // runId가 있으면 해당 run만 참조 (다른 sortie의 run 누출 방지)
  const run = runId ? getRunById(runId) : getVisibleRun(carrierId);
  if (!run || run.blocks.length === 0) return [];

  const blockLines = renderBlockLines(run.blocks);
  if (blockLines.length === 0) return [];

  // 빈 줄 필터링 후 tail 방식: 마지막 MAX_CONTENT_LINES줄만 사용
  const nonEmpty = blockLines.filter((bl) => bl.text.trim());
  const tail = nonEmpty.slice(-MAX_CONTENT_LINES);
  const indent = `  ${PANEL_DIM_COLOR}${connector}${ANSI_RESET}    `;

  return tail.map((bl) => {
    const coloredText = blockLineToAnsi(bl);
    return truncateToWidth(`${indent}${coloredText}`, contentWidth);
  });
}

/** onUpdate용 partial result 생성 */
export function buildPartialUpdate(
  state: SortieState,
  assignments: CarrierAssignment[],
): { content: { type: "text"; text: string }[]; details: SortieResultDetails } {
  const results: CarrierSortieResult[] = assignments.map((a) => {
    const progress = state.carriers.get(a.carrier)!;
    const pText = progressText(progress);
    return {
      carrierId: a.carrier,
      displayName: resolveCarrierDisplayName(a.carrier),
      status: progress.status === "done" ? "done" : progress.status === "error" ? "error" : "aborted",
      responseText: pText || progress.status,
    } as CarrierSortieResult;
  });

  const doneCount = [...state.carriers.values()].filter((p) => p.status === "done").length;
  const total = assignments.length;

  return {
    content: [{ type: "text", text: `Carriers Sortie: ${doneCount}/${total} carriers completed` }],
    details: { sortieKey: state.sortieKey, results },
  };
}
