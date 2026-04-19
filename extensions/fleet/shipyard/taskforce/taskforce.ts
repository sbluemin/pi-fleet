/**
 * fleet/shipyard/taskforce/taskforce.ts — carrier_taskforce 도구 등록
 *
 * 선택된 Carrier의 persona를 유지한 채로
 * 선택된 캐리어에 설정된 CLI 백엔드(2개 이상)에 동시 실행하여 교차검증합니다.
 *
 * - execute(): executeOneShot 기반 비세션 병렬 실행
 * - renderCall(): TaskForceCallComponent 통해 실시간 스트리밍 렌더링
 * - renderResult(): 완료 후 결과 캐시에서 렌더링
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { getLogAPI } from "../../../core/log/bridge.js";
import { executeOneShot } from "../../../core/agentclientprotocol/executor.js";
import {
  getTaskForceModelConfig,
  getConfiguredTaskForceCarrierIds,
  getConfiguredTaskForceBackends,
} from "../store.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  finalizeRun,
  updateRunStatus,
  getVisibleRun,
} from "../../bridge/streaming/stream-store.js";
import { renderBlockLines, blockLineToAnsi } from "../../bridge/render/block-renderer.js";
import {
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  resolveCarrierDisplayName,
} from "../carrier/framework.js";
import { composeTier2Request } from "../carrier/prompts.js";
import {
  ANSI_RESET,
  PANEL_COLOR,
  PANEL_DIM_COLOR,
  SPINNER_FRAMES,
  SYM_INDICATOR,
  CLI_DISPLAY_NAMES,
  CARRIER_COLORS,
} from "../../constants.js";
import {
  FLEET_TASKFORCE_DESCRIPTION,
  buildTaskForcePromptSnippet,
  buildTaskForcePromptGuidelines,
  buildTaskForceSchema,
} from "./prompts.js";
import {
  TASKFORCE_STATE_KEY,
  TASKFORCE_RESULT_CACHE_KEY,
  type BackendProgress,
  type TaskForceCliType,
  type TaskForceResult,
  type TaskForceState,
} from "./types.js";

// ─── 타입 ────────────────────────────────────────────────

interface TaskForceResultDetails {
  carrierId: string;
  requestKey: string;
  results: TaskForceResult[];
  /** 총 경과시간 (ms) — 히스토리 복원 시 표시용 */
  elapsedMs?: number;
}

interface TaskForceRenderContext {
  invalidate?: () => void;
  lastComponent?: unknown;
}

// ─── 상수 ────────────────────────────────────────────────

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

/** 백엔드별 최대 콘텐츠 라인 수 (tail 방식) */
const MAX_CONTENT_LINES = 5;

/** 히스토리 복원용 결과 캐시 최대 보관 수 */
const MAX_RESULT_CACHE_ENTRIES = 24;

const TASKFORCE_RUN_PREFIX = "taskforce";

// ─── 공개 API ────────────────────────────────────────────

/**
 * carrier_taskforce 도구 정의(ToolDefinition)를 조립해 반환합니다.
 *
 * pi.registerTool 호출 오너쉽은 fleet/index.ts가 부팅 시 1회 등록합니다.
 * 이 팩토리는 등록 시 필요한 schema/guidelines/execute/render 등
 * 도구 기능 자체만을 제공합니다. 등록 불필요 시 null을 반환합니다.
 */
export function buildTaskForceToolConfig() {
  const allCarriers = getRegisteredOrder();
  if (allCarriers.length < 1) return null;

  // TF 편성이 가능한 캐리어만 스키마/가이드라인에 반영
  const configuredCarriers = getConfiguredTaskForceCarrierIds(allCarriers);
  const guidelines = buildTaskForcePromptGuidelines(configuredCarriers);

  return {
    name: "carrier_taskforce",
    label: "Carrier Task Force",
    description: FLEET_TASKFORCE_DESCRIPTION,
    promptSnippet: buildTaskForcePromptSnippet(),
    promptGuidelines: guidelines,
    parameters: buildTaskForceSchema(configuredCarriers),

    // ── renderCall: 실시간 스트리밍 표시 ──
    renderCall(args: { carrier?: string; request?: string }, theme: any, context?: TaskForceRenderContext) {
      const component = context?.lastComponent instanceof TaskForceCallComponent
        ? context.lastComponent
        : new TaskForceCallComponent();
      component.setState(args.carrier ?? "", args.request ?? "", theme, context);
      return component;
    },

    // ── renderResult: 완료 후 캐시에서 표시 ──
    renderResult(result: any, _options: { expanded: boolean; isPartial: boolean }, _theme: any) {
      const details = result.details as TaskForceResultDetails | undefined;
      if (details?.carrierId && details.requestKey && details.results) {
        setResultCache(details.requestKey, details.carrierId, details.results, details.elapsedMs);
      }
      return { render() { return []; }, invalidate() {} };
    },

    // ── execute: 활성 백엔드 병렬 실행 ──
    async execute(
      _id: string,
      params: { carrier: string; request: string },
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: ExtensionContext,
    ) {
      const { carrier: carrierId, request } = params;
      const requestKey = buildTaskForceRequestKey(carrierId, request);

      assertRegisteredCarrier(carrierId);
      const activeBackends = assertTaskForceFormable(carrierId);
      const composedRequest = buildComposedTaskForceRequest(carrierId, request);

      // 진행 상태 초기화
      const state = initTaskForceState(carrierId, requestKey, activeBackends);

      // 진행률 업데이트 타이머 (200ms)
      const updateTimer = setInterval(() => {
        if (!onUpdate) return;
        onUpdate(buildPartialUpdate(carrierId, state));
      }, 200);

      try {
        // 활성 백엔드 병렬 실행
        const settledResults = await Promise.allSettled(
          activeBackends.map((cliType) =>
            runTaskForceBackend(cliType, carrierId, composedRequest, state, signal, ctx),
          ),
        );

        // 완료 시각 기록
        state.finishedAt = Date.now();

        const results = collectTaskForceResults(settledResults, activeBackends);
        const elapsedMs = state.finishedAt - state.startedAt;

        // 결과 캐시 저장
        setResultCache(requestKey, carrierId, results, elapsedMs);

        return {
          content: [{ type: "text" as const, text: buildTaskForceContentText(results) }],
          details: { carrierId, requestKey, results, elapsedMs } satisfies TaskForceResultDetails,
        };
      } finally {
        clearInterval(updateTimer);
        clearTaskForceState(requestKey);
      }
    },
  };
}

// ─── 내부 상태 관리 ──────────────────────────────────────

function formatCarrierIdForMessage(carrierId: string): string {
  return JSON.stringify(carrierId);
}

function assertRegisteredCarrier(carrierId: string): void {
  const allIds = new Set(getRegisteredOrder());
  if (!allIds.has(carrierId)) {
    const registered = [...allIds].map(formatCarrierIdForMessage).join(", ") || "(none)";
    throw new Error(
      `Unknown carrier: ${formatCarrierIdForMessage(carrierId)}. Registered carriers: ${registered}`,
    );
  }
}

function assertTaskForceFormable(carrierId: string): TaskForceCliType[] {
  const activeBackends = getConfiguredTaskForceBackends(carrierId);
  if (activeBackends.length >= 2) return activeBackends;
  throw new Error(
    `Carrier ${formatCarrierIdForMessage(carrierId)} needs ≥2 configured Task Force backends, got ${activeBackends.length}. ` +
    `Open Carrier Status (Alt+O), select ${formatCarrierIdForMessage(carrierId)}, press T to add a backend.`,
  );
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
  cliType: TaskForceCliType,
  carrierId: string,
  request: string,
  state: TaskForceState,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<TaskForceResult> {
  const progress = state.backends.get(cliType)!;
  progress.status = "connecting";

  const syntheticId = buildTaskForceRunId(carrierId, cliType);
  const modelConfig = getRequiredTaskForceModelConfig(carrierId, cliType);

  // synthetic run은 동일 키로 재사용하여 반복 실행 누적을 방지합니다.
  prepareTaskForceRun(syntheticId);
  getLogAPI().debug(
    "fleet-taskforce",
    [
      `carrier_taskforce [backend=${cliType}] carrier=${carrierId} run=${syntheticId}`,
      "----- BEGIN REQUEST -----",
      request,
      "----- END REQUEST -----",
    ].join("\n"),
    { hideFromFooter: true, category: "prompt" },
  );

  const result = await executeOneShot({
    carrierId: syntheticId,
    cliType,
    request,
    cwd: ctx.cwd,
    model: modelConfig.model,
    effort: modelConfig.effort,
    budgetTokens: modelConfig.budgetTokens,
    signal,
    onStatusChange: (status) => {
      updateRunStatus(syntheticId, status);
    },
    onMessageChunk: (text: string) => {
      progress.status = "streaming";
      progress.lineCount++;
      appendTextBlock(syntheticId, sanitizeChunk(text));
    },
    onThoughtChunk: (text: string) => {
      appendThoughtBlock(syntheticId, sanitizeChunk(text));
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
    },
  });

  progress.status = result.status === "done" ? "done" : "error";
  finalizeTaskForceRun(syntheticId, result);
  return buildTaskForceResult(cliType, result);
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
  settledResults: PromiseSettledResult<TaskForceResult>[],
  activeBackends: readonly TaskForceCliType[],
): TaskForceResult[] {
  return settledResults.map((settled, index) => {
    if (settled.status === "fulfilled") return settled.value;
    return buildTaskForceErrorResult(
      activeBackends[index]!,
      settled.reason,
    );
  });
}

function buildTaskForceErrorResult(cliType: TaskForceCliType, reason: unknown): TaskForceResult {
  const errorMessage = sanitizeChunk(
    reason instanceof Error
      ? reason.message
      : String(reason),
  );

  return {
    cliType,
    displayName: CLI_DISPLAY_NAMES[cliType] ?? cliType,
    status: "error",
    responseText: `Error: ${errorMessage}`,
    error: errorMessage,
  };
}

function buildTaskForceContentText(results: TaskForceResult[]): string {
  return results
    .map((result) => {
      const trimmed = sanitizeChunk(result.responseText).replace(/\n{3,}/g, "\n\n").trim() || "(no output)";
      return [
        `<<<TASKFORCE:${result.cliType}:${result.status}>>>`,
        trimmed,
        `<<<END_TASKFORCE:${result.cliType}>>>`,
      ].join("\n");
    })
    .join("\n\n");
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
    frame: 0,
    timer: null,
    startedAt: Date.now(),
  };
  state.timer = setInterval(() => { state.frame++; }, 100);
  (globalThis as any)[TASKFORCE_STATE_KEY] = state;
  return state;
}

function clearTaskForceState(requestKey?: string): void {
  const state = getTaskForceState();
  if (requestKey && state?.requestKey !== requestKey) return;
  if (state?.timer) clearInterval(state.timer);
  (globalThis as any)[TASKFORCE_STATE_KEY] = null;
}

// ─── 결과 캐시 ───────────────────────────────────────────

/** 결과 캐시 엔트리 */
interface TaskForceResultCacheEntry {
  carrierId: string;
  results: TaskForceResult[];
  elapsedMs?: number;
}

function getResultCacheStore(): Map<string, TaskForceResultCacheEntry> {
  let store = (globalThis as any)[TASKFORCE_RESULT_CACHE_KEY] as
    | Map<string, TaskForceResultCacheEntry>
    | undefined;
  if (!store) {
    store = new Map();
    (globalThis as any)[TASKFORCE_RESULT_CACHE_KEY] = store;
  }
  return store;
}

function setResultCache(requestKey: string, carrierId: string, results: TaskForceResult[], elapsedMs?: number): void {
  const store = getResultCacheStore();
  store.delete(requestKey);
  store.set(requestKey, { carrierId, results, elapsedMs });

  while (store.size > MAX_RESULT_CACHE_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}

function getResultCache(requestKey: string): TaskForceResultCacheEntry | null {
  return getResultCacheStore().get(requestKey) ?? null;
}

function countBackendStatuses(backends: Iterable<BackendProgress>): { done: number; error: number } {
  let done = 0;
  let error = 0;

  for (const backend of backends) {
    if (backend.status === "done") done++;
    if (backend.status === "error") error++;
  }

  return { done, error };
}

function countResultStatuses(results: TaskForceResult[]): { done: number; error: number } {
  let done = 0;
  let error = 0;

  for (const result of results) {
    if (result.status === "done") {
      done++;
      continue;
    }
    error++;
  }

  return { done, error };
}

// ─── partial 업데이트 ────────────────────────────────────

function buildPartialUpdate(
  carrierId: string,
  state: TaskForceState,
): { content: { type: "text"; text: string }[]; details: any } {
  const { done: doneCount } = countBackendStatuses(state.backends.values());
  const total = state.backends.size;
  const carrierDisplay = sanitizeChunk(resolveCarrierDisplayName(carrierId));
  return {
    content: [{
      type: "text" as const,
      text: `Task Force [${carrierDisplay}]: ${doneCount}/${total} backends completed`,
    }],
    details: {},
  };
}

// ─── renderCall 컴포넌트 ─────────────────────────────────

class TaskForceCallComponent {
  private carrierId = "";
  private requestKey = "";
  private theme: any = null;
  private context: TaskForceRenderContext | undefined = undefined;
  private lastRenderedLineCount = 0;
  private compactCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private compactCleanupPending = false;

  setState(carrierId: string, request: string, theme: any, context: TaskForceRenderContext | undefined): void {
    this.carrierId = carrierId;
    this.requestKey = buildTaskForceRequestKey(carrierId, request);
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

    const needsCompactCleanup =
      this.lastRenderedLineCount > nextLineCount && !this.compactCleanupPending;

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
    const termCols = process.stdout.columns || 80;
    const effectiveWidth = Math.min(width, termCols);
    const globalState = getTaskForceState();
    const state = globalState?.requestKey === this.requestKey ? globalState : null;
    const cache = getResultCache(this.requestKey);
    const frame = state?.frame ?? 0;
    const cachedResults = cache?.carrierId === this.carrierId ? cache.results : [];
    const renderableCachedResults = state
      ? cachedResults
      : getRenderableCachedResults(this.carrierId, cachedResults);
    const activeCliTypes = state
      ? [...state.backends.keys()]
      : renderableCachedResults.length > 0
        ? renderableCachedResults.map((result) => result.cliType)
        : [];
    const lines: string[] = [];

    // ── 경과시간 계산 ──
    let elapsedSuffix = "";
    if (state) {
      const elapsed = state.finishedAt
        ? state.finishedAt - state.startedAt
        : Date.now() - state.startedAt;
      elapsedSuffix = this.theme.fg("dim", ` · ${formatElapsed(elapsed)}`);
    } else if (cache?.elapsedMs != null) {
      elapsedSuffix = this.theme.fg("dim", ` · ${formatElapsed(cache.elapsedMs)}`);
    }

    // ── 헤더 ──
    const carrierDisplay = this.carrierId
      ? resolveCarrierDisplayName(this.carrierId)
      : "...";
    const headerTitle = this.theme.fg("toolTitle", this.theme.bold("◈ Task Force"));

    lines.push(
      `${headerTitle} ${PANEL_DIM_COLOR}·${ANSI_RESET} ${PANEL_COLOR}${carrierDisplay}${ANSI_RESET} ${this.theme.fg("dim", `· ${buildTaskForceHeaderSuffix(state, cachedResults)}`)}${elapsedSuffix}`,
    );

    // ── 백엔드 트리 ──
    for (let i = 0; i < activeCliTypes.length; i++) {
      const cliType = activeCliTypes[i]!;
      const isLast = i === activeCliTypes.length - 1;
      const treePrefix = isLast ? "└─" : "├─";
      const connector = isLast ? "   " : "│  ";

      const displayName = CLI_DISPLAY_NAMES[cliType] ?? cliType;
      const color = CARRIER_COLORS[cliType] ?? PANEL_COLOR;
      const progress = state?.backends.get(cliType);
      const cachedResult = renderableCachedResults.find((result) => result.cliType === cliType);
      const icon = resolveBackendIcon(progress, cachedResult, frame, cliType);

      const pText = progress ? progressText(progress) : "";
      const progressSuffix = pText
        ? ` ${PANEL_DIM_COLOR}[${pText}]${ANSI_RESET}`
        : "";

      lines.push(
        `  ${PANEL_DIM_COLOR}${treePrefix}${ANSI_RESET} ${icon} ${color}${displayName}${ANSI_RESET}${progressSuffix}`,
      );

      // 스트리밍 중인 백엔드만 콘텐츠 표시
      const isStreaming = progress && (progress.status === "connecting" || progress.status === "streaming");
      if (isStreaming) {
        const syntheticId = buildTaskForceRunId(this.carrierId, cliType);
        const contentLines = renderBackendContentLines(syntheticId, connector, effectiveWidth, this.theme);
        for (const cl of contentLines) {
          lines.push(cl);
        }
      }
    }

    return lines.map((line) =>
      visibleWidth(line) > effectiveWidth ? truncateToWidth(line, effectiveWidth) : line,
    );
  }
}

// ─── 내부 렌더링 헬퍼 ────────────────────────────────────

function buildTaskForceHeaderSuffix(
  state: TaskForceState | null,
  cachedResults: TaskForceResult[],
): string {
  if (state) {
    const { done, error } = countBackendStatuses(state.backends.values());
    const total = state.backends.size;
    const running = total - done - error;
    const parts: string[] = [`${total} backends`];
    if (running > 0) parts.push(`${running} running`);
    if (done > 0) parts.push(`${done} done`);
    if (error > 0) parts.push(`${error} err`);
    return parts.join(", ");
  }

  if (cachedResults.length > 0) {
    const { done, error } = countResultStatuses(cachedResults);
    const parts: string[] = [`${cachedResults.length} backends`];
    if (done > 0) parts.push(`${done} done`);
    if (error > 0) parts.push(`${error} error`);
    return parts.join(", ");
  }

  return `launching backends`;
}

function getRenderableCachedResults(
  carrierId: string,
  cachedResults: TaskForceResult[],
): TaskForceResult[] {
  if (cachedResults.length === 0) return cachedResults;
  const currentBackends = new Set(getConfiguredTaskForceBackends(carrierId));
  const isSubset = cachedResults.every((result) => currentBackends.has(result.cliType));
  return isSubset ? cachedResults : [];
}

function resolveBackendIcon(
  progress: BackendProgress | undefined,
  cachedResult: TaskForceResult | undefined,
  frame: number,
  cliType: TaskForceCliType,
): string {
  if (progress) {
    return backendStatusIcon(progress.status, frame, cliType);
  }

  if (cachedResult) {
    return cachedResult.status === "done"
      ? `\x1b[38;2;100;200;100m${SYM_INDICATOR}${ANSI_RESET}`
      : `\x1b[38;2;255;80;80m${SYM_INDICATOR}${ANSI_RESET}`;
  }

  return `${PANEL_DIM_COLOR}○${ANSI_RESET}`;
}

function backendStatusIcon(status: BackendProgress["status"], frame: number, cliType: TaskForceCliType): string {
  const color = CARRIER_COLORS[cliType] ?? PANEL_COLOR;
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

function progressText(p: BackendProgress): string {
  const parts: string[] = [];
  if (p.toolCallCount > 0) parts.push(`${p.toolCallCount}T`);
  if (p.lineCount > 0) parts.push(`${p.lineCount}L`);
  return parts.length > 0 ? parts.join("·") : "";
}

function renderBackendContentLines(
  syntheticId: string,
  connector: string,
  contentWidth: number,
  _theme: any,
): string[] {
  const run = getVisibleRun(syntheticId);
  if (!run || run.blocks.length === 0) return [];

  const blockLines = renderBlockLines(run.blocks);
  if (blockLines.length === 0) return [];

  const nonEmpty = blockLines.filter((bl) => bl.text.trim());
  const tail = nonEmpty.slice(-MAX_CONTENT_LINES);
  const indent = `  ${PANEL_DIM_COLOR}${connector}${ANSI_RESET}    `;

  return tail.map((bl) => {
    const coloredText = blockLineToAnsi(bl);
    return truncateToWidth(`${indent}${coloredText}`, contentWidth);
  });
}

function buildTaskForceRequestKey(carrierId: string, request: string): string {
  return JSON.stringify([carrierId, request.replace(/\r\n?/g, "\n").trim()]);
}

function buildTaskForceRunId(carrierId: string, cliType: TaskForceCliType): string {
  const encodedCarrierId = Buffer.from(carrierId, "utf-8").toString("base64url");
  return `${TASKFORCE_RUN_PREFIX}:${cliType}:${encodedCarrierId}`;
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
  return text
    .replace(/\r/g, "")
    .replace(/\x1b\[\d*[ABCDEFGHJKST]/g, "")
    .replace(/\x1b\[\d*;\d*[Hf]/g, "")
    .replace(/\x1b\[(?:\??\d+[hl]|2J|K)/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function sanitizeToolLabel(text: string): string {
  return sanitizeChunk(text).replace(/\s+/g, " ").trim() || "(unnamed)";
}
