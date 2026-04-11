/**
 * fleet/shipyard/squadron/squadron.ts — carrier_squadron 도구 등록
 *
 * 동일 캐리어 타입의 여러 인스턴스를 병렬로 출격하여
 * 하나의 임무를 분할 처리합니다.
 *
 * - execute(): executeOneShot 기반 비세션 병렬 실행
 * - renderCall(): SquadronCallComponent 통해 실시간 스트리밍 렌더링
 * - renderResult(): 완료 후 결과 캐시에서 렌더링
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { executeOneShot } from "../../../core/agent/executor.js";
import { loadModels } from "../store.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  finalizeRun,
  updateRunStatus,
  getVisibleRun,
} from "../../streaming/stream-store.js";
import { renderBlockLines, blockLineToAnsi } from "../../render/block-renderer.js";
import {
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  getSquadronEnabledIds,
  isSquadronCarrierEnabled,
  resolveCarrierDisplayName,
} from "../carrier/framework.js";
import { composeTier2Request } from "../carrier/prompts.js";
import {
  ANSI_RESET,
  PANEL_COLOR,
  PANEL_DIM_COLOR,
  SPINNER_FRAMES,
  SYM_INDICATOR,
  CARRIER_COLORS,
} from "../../constants.js";
import {
  FLEET_SQUADRON_DESCRIPTION,
  buildSquadronPromptSnippet,
  buildSquadronPromptGuidelines,
  buildSquadronSchema,
} from "./prompts.js";
import {
  SQUADRON_STATE_KEY,
  SQUADRON_RESULT_CACHE_KEY,
  SQUADRON_MAX_INSTANCES,
  type SubtaskProgress,
  type SquadronResult,
  type SquadronState,
} from "./types.js";

// ─── 타입 ────────────────────────────────────────────────

interface SquadronResultDetails {
  carrierId: string;
  requestKey: string;
  results: SquadronResult[];
  /** 총 경과시간 (ms) — 히스토리 복원 시 표시용 */
  elapsedMs?: number;
}

interface SquadronRenderContext {
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

/** 서브태스크별 최대 콘텐츠 라인 수 (tail 방식) */
const MAX_CONTENT_LINES = 5;

/** 히스토리 복원용 결과 캐시 최대 보관 수 */
const MAX_RESULT_CACHE_ENTRIES = 24;

const SQUADRON_RUN_PREFIX = "squadron";

// ─── 공개 API ────────────────────────────────────────────

/**
 * carrier_squadron 도구를 PI에 등록합니다.
 * index.ts에서 호출됩니다.
 */
export function registerFleetSquadron(pi: ExtensionAPI): void {
  const allCarriers = getRegisteredOrder();
  if (allCarriers.length < 1) return;

  // squadron 활성 캐리어만 스키마/가이드라인에 반영
  const enabledCarriers = getSquadronEnabledIds();
  const guidelines = buildSquadronPromptGuidelines(enabledCarriers);

  pi.registerTool({
    name: "carrier_squadron",
    label: "Carrier Squadron",
    description: FLEET_SQUADRON_DESCRIPTION,
    promptSnippet: buildSquadronPromptSnippet(),
    promptGuidelines: guidelines,
    parameters: buildSquadronSchema(enabledCarriers),

    // ── renderCall: 실시간 스트리밍 표시 ──
    renderCall(
      args: { carrier?: string; expected_subtask_count?: number; subtasks?: Array<{ title: string; request: string }> },
      theme: any,
      context?: SquadronRenderContext,
    ) {
      const component = context?.lastComponent instanceof SquadronCallComponent
        ? context.lastComponent
        : new SquadronCallComponent();
      component.setState(args.carrier ?? "", args.subtasks ?? [], theme, context);
      return component;
    },

    // ── renderResult: 완료 후 캐시에서 표시 ──
    renderResult(result: any, _options: { expanded: boolean; isPartial: boolean }, _theme: any) {
      const details = result.details as SquadronResultDetails | undefined;
      if (details?.carrierId && details.requestKey && details.results) {
        setResultCache(details.requestKey, details.carrierId, details.results, details.elapsedMs);
      }
      return { render() { return []; }, invalidate() {} };
    },

    // ── execute: 병렬 실행 ──
    async execute(
      _id: string,
      params: { carrier: string; expected_subtask_count: number; subtasks: Array<{ title: string; request: string }> },
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: ExtensionContext,
    ) {
      const { carrier: carrierId, expected_subtask_count, subtasks } = params;

      // 1. 검증
      assertRegisteredCarrier(carrierId);
      assertSquadronEnabled(carrierId);
      assertSubtaskCount(expected_subtask_count, subtasks.length);
      assertSubtaskLimit(subtasks.length);

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

      // 3. 진행 상태 초기화
      const requestKey = buildSquadronRequestKey(carrierId, sanitizedSubtasks);
      const state = initSquadronState(carrierId, requestKey, sanitizedSubtasks);

      // 4. 200ms onUpdate 타이머
      const updateTimer = setInterval(() => {
        if (!onUpdate) return;
        onUpdate(buildPartialUpdate(carrierId, state));
      }, 200);

      try {
        // 5. base 캐리어의 모델 설정 조회
        const modelConfig = loadModels()[carrierId];
        const cliType = carrierConfig?.cliType ?? "claude";

        // 6. 병렬 실행 (executeOneShot × N)
        const settledResults = await Promise.allSettled(
          sanitizedSubtasks.map((st, index) =>
            runSquadronInstance(index, st.title, composedSubtasks[index]!, {
              carrierId,
              cliType,
              modelConfig,
              state,
              signal,
              ctx,
              requestKey,
            }),
          ),
        );

        // 완료 시각 기록
        state.finishedAt = Date.now();

        // 7. 결과 수집 + 캐시
        const results = collectSquadronResults(settledResults, sanitizedSubtasks);
        const elapsedMs = state.finishedAt - state.startedAt;
        setResultCache(requestKey, carrierId, results, elapsedMs);

        return {
          content: [{ type: "text" as const, text: buildSquadronContentText(results) }],
          details: { carrierId, requestKey, results, elapsedMs } satisfies SquadronResultDetails,
        };
      } finally {
        clearInterval(updateTimer);
        clearSquadronState(requestKey);
      }
    },
  });
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

function assertSquadronEnabled(carrierId: string): void {
  if (!isSquadronCarrierEnabled(carrierId)) {
    throw new Error(
      `Carrier ${formatCarrierIdForMessage(carrierId)} is not enabled for Squadron.\n` +
      `→ Open Carrier Status (Alt+O), select ${formatCarrierIdForMessage(carrierId)}, press S to enable.`,
    );
  }
}

function assertSubtaskCount(expected: number, actual: number): void {
  if (expected !== actual) {
    throw new Error(
      `expected_subtask_count (${expected}) does not match subtasks array length (${actual}).` +
      ` These must be equal.`,
    );
  }
}

function assertSubtaskLimit(count: number): void {
  if (count < 1) {
    throw new Error(`At least 1 subtask is required.`);
  }
  if (count > SQUADRON_MAX_INSTANCES) {
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
    ctx: ExtensionContext;
    requestKey: string;
  },
): Promise<SquadronResult> {
  const progress = opts.state.subtasks.get(index)!;
  progress.status = "connecting";

  // Synthetic ID: squadron:<base64url(requestKey)>:<index>
  const syntheticId = buildSquadronRunId(opts.requestKey, index);

  // synthetic run 생성/재사용 (taskforce 패턴)
  prepareSquadronRun(syntheticId);

  const result = await executeOneShot({
    carrierId: syntheticId,
    cliType: opts.cliType as any,
    request,
    cwd: opts.ctx.cwd,
    model: opts.modelConfig?.model,
    effort: opts.modelConfig?.effort,
    budgetTokens: opts.modelConfig?.budgetTokens,
    signal: opts.signal,
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
    onToolCall: (toolTitle: string, toolStatus: string, _rawOutput?: string, toolCallId?: string) => {
      progress.status = "streaming";
      progress.toolCallCount++;
      upsertToolBlock(
        syntheticId,
        sanitizeToolLabel(toolTitle),
        sanitizeToolLabel(toolStatus),
        toolCallId,
      );
    },
  });

  progress.status = result.status === "done" ? "done" : "error";
  finalizeSquadronRun(syntheticId, result);
  return buildSquadronResult(index, title, result);
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
  return {
    index,
    title,
    status: "error",
    responseText: `Error: ${errorMessage}`,
    error: errorMessage,
  };
}

function buildSquadronContentText(results: SquadronResult[]): string {
  return results
    .map((result) => {
      const trimmed = sanitizeChunk(result.responseText).replace(/\n{3,}/g, "\n\n").trim() || "(no output)";
      return [
        `<<<SQUADRON:${result.index}:${result.title}:${result.status}>>>`,
        trimmed,
        `<<<END_SQUADRON:${result.index}:${result.title}>>>`,
      ].join("\n");
    })
    .join("\n\n");
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
  // 동일 key state가 이미 있으면 타이머 정리 후 교체
  const existing = store.get(requestKey);
  if (existing?.timer) clearInterval(existing.timer);

  const state: SquadronState = {
    carrierId,
    requestKey,
    subtasks: new Map(
      subtasks.map((_, i) => [i, { status: "queued", toolCallCount: 0, lineCount: 0 }]),
    ),
    subtaskTitles: subtasks.map((st) => st.title),
    frame: 0,
    timer: null,
    startedAt: Date.now(),
  };
  state.timer = setInterval(() => { state.frame++; }, 100);
  store.set(requestKey, state);
  return state;
}

function clearSquadronState(requestKey: string): void {
  const store = getStateStore();
  const state = store.get(requestKey);
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  store.delete(requestKey);
}

// ─── 결과 캐시 ───────────────────────────────────────────

/** 결과 캐시 엔트리 */
interface SquadronResultCacheEntry {
  carrierId: string;
  results: SquadronResult[];
  elapsedMs?: number;
}

function getResultCacheStore(): Map<string, SquadronResultCacheEntry> {
  let store = (globalThis as any)[SQUADRON_RESULT_CACHE_KEY] as
    | Map<string, SquadronResultCacheEntry>
    | undefined;
  if (!store) {
    store = new Map();
    (globalThis as any)[SQUADRON_RESULT_CACHE_KEY] = store;
  }
  return store;
}

function setResultCache(requestKey: string, carrierId: string, results: SquadronResult[], elapsedMs?: number): void {
  const store = getResultCacheStore();
  store.delete(requestKey);
  store.set(requestKey, { carrierId, results, elapsedMs });

  while (store.size > MAX_RESULT_CACHE_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}

function getResultCache(requestKey: string): SquadronResultCacheEntry | null {
  return getResultCacheStore().get(requestKey) ?? null;
}

// ─── partial 업데이트 ────────────────────────────────────

function buildPartialUpdate(
  carrierId: string,
  state: SquadronState,
): { content: { type: "text"; text: string }[]; details: any } {
  const { done: doneCount } = countSubtaskStatuses(state.subtasks.values());
  const total = state.subtasks.size;
  const carrierDisplay = sanitizeChunk(resolveCarrierDisplayName(carrierId));
  return {
    content: [{
      type: "text" as const,
      text: `Squadron [${carrierDisplay}]: ${doneCount}/${total} subtasks completed`,
    }],
    details: {},
  };
}

function countSubtaskStatuses(subtasks: Iterable<SubtaskProgress>): { done: number; error: number } {
  let done = 0;
  let error = 0;
  for (const st of subtasks) {
    if (st.status === "done") done++;
    if (st.status === "error") error++;
  }
  return { done, error };
}

function countResultStatuses(results: SquadronResult[]): { done: number; error: number } {
  let done = 0;
  let error = 0;
  for (const result of results) {
    if (result.status === "done") done++;
    else error++;
  }
  return { done, error };
}

// ─── renderCall 컴포넌트 ─────────────────────────────────

class SquadronCallComponent {
  private carrierId = "";
  private subtasks: Array<{ title: string; request: string }> = [];
  private requestKey = "";
  private theme: any = null;
  private context: SquadronRenderContext | undefined = undefined;
  private lastRenderedLineCount = 0;
  private compactCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private compactCleanupPending = false;

  setState(
    carrierId: string,
    subtasks: Array<{ title: string; request: string }>,
    theme: any,
    context: SquadronRenderContext | undefined,
  ): void {
    this.carrierId = carrierId;
    // execute와 동일한 sanitizeTitle 적용 — requestKey/syntheticId/표시 일치 보장
    this.subtasks = subtasks.map((st) => ({ title: sanitizeTitle(st.title), request: st.request }));
    this.requestKey = buildSquadronRequestKey(carrierId, this.subtasks);
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
    const state = this.requestKey ? getSquadronState(this.requestKey) : null;
    const cache = getResultCache(this.requestKey);
    const frame = state?.frame ?? 0;
    const cachedResults = cache?.carrierId === this.carrierId ? cache.results : [];
    const lines: string[] = [];

    // 서브태스크 목록 결정: 실행 중 상태 or 파라미터에서 가져온 목록
    const subtaskTitles = state?.subtaskTitles ?? this.subtasks.map((st) => st.title);
    const subtaskCount = subtaskTitles.length || this.subtasks.length;

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
    const headerTitle = this.theme.fg("toolTitle", this.theme.bold("◈ Squadron"));

    lines.push(
      `${headerTitle} ${PANEL_DIM_COLOR}·${ANSI_RESET} ${PANEL_COLOR}${carrierDisplay}${ANSI_RESET} ${this.theme.fg("dim", `· ${buildSquadronHeaderSuffix(state, cachedResults, subtaskCount)}`)}${elapsedSuffix}`,
    );

    // ── 서브태스크 트리 ──
    const count = Math.max(subtaskTitles.length, cachedResults.length);
    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1;
      const treePrefix = isLast ? "└─" : "├─";
      const connector = isLast ? "   " : "│  ";

      const title = subtaskTitles[i] ?? cachedResults[i]?.title ?? `subtask-${i}`;
      const carrierConfig = this.carrierId ? getRegisteredCarrierConfig(this.carrierId) : undefined;
      const color = carrierConfig ? (CARRIER_COLORS[carrierConfig.cliType] ?? PANEL_COLOR) : PANEL_COLOR;
      const progress = state?.subtasks.get(i);
      const cachedResult = cachedResults[i];
      const icon = resolveSubtaskIcon(progress, cachedResult, frame, color);

      const pText = progress ? progressText(progress) : "";
      const progressSuffix = pText
        ? ` ${PANEL_DIM_COLOR}[${pText}]${ANSI_RESET}`
        : "";

      lines.push(
        `  ${PANEL_DIM_COLOR}${treePrefix}${ANSI_RESET} ${icon} ${color}${title}${ANSI_RESET}${progressSuffix}`,
      );

      // 스트리밍 중인 서브태스크만 콘텐츠 표시
      const isStreaming = progress && (progress.status === "connecting" || progress.status === "streaming");
      if (isStreaming) {
        const syntheticId = buildSquadronRunId(this.requestKey, i);
        const contentLines = renderSubtaskContentLines(syntheticId, connector, effectiveWidth, this.theme);
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

function buildSquadronHeaderSuffix(
  state: SquadronState | null,
  cachedResults: SquadronResult[],
  subtaskCount: number,
): string {
  if (state) {
    const { done, error } = countSubtaskStatuses(state.subtasks.values());
    const running = state.subtasks.size - done - error;
    const parts: string[] = [`${state.subtasks.size} subtasks`];
    if (running > 0) parts.push(`${running} running`);
    if (done > 0) parts.push(`${done} done`);
    if (error > 0) parts.push(`${error} err`);
    return parts.join(", ");
  }

  if (cachedResults.length > 0) {
    const { done, error } = countResultStatuses(cachedResults);
    const parts: string[] = [`${cachedResults.length} subtasks`];
    if (done > 0) parts.push(`${done} done`);
    if (error > 0) parts.push(`${error} error`);
    return parts.join(", ");
  }

  return `${subtaskCount} subtasks launched`;
}

function resolveSubtaskIcon(
  progress: SubtaskProgress | undefined,
  cachedResult: SquadronResult | undefined,
  frame: number,
  color: string,
): string {
  if (progress) {
    return subtaskStatusIcon(progress.status, frame, color);
  }

  if (cachedResult) {
    return cachedResult.status === "done"
      ? `\x1b[38;2;100;200;100m${SYM_INDICATOR}${ANSI_RESET}`
      : `\x1b[38;2;255;80;80m${SYM_INDICATOR}${ANSI_RESET}`;
  }

  return `${PANEL_DIM_COLOR}○${ANSI_RESET}`;
}

function subtaskStatusIcon(status: SubtaskProgress["status"], frame: number, color: string): string {
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

function progressText(p: SubtaskProgress): string {
  const parts: string[] = [];
  if (p.toolCallCount > 0) parts.push(`${p.toolCallCount}T`);
  if (p.lineCount > 0) parts.push(`${p.lineCount}L`);
  return parts.length > 0 ? parts.join("·") : "";
}

function renderSubtaskContentLines(
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
