/**
 * fleet/carrier/sortie.ts — Carrier Sortie 도구 등록
 *
 * carrier 위임의 유일한 PI 도구입니다.
 * 1개 이상 Carrier에 작업을 위임(출격)할 때 사용합니다.
 * PI가 `carrier_sortie` 도구를 호출하면 내부에서
 * N개 `runAgentRequest()`를 병렬 실행하고,
 * renderCall에서 스트리밍 콘텐츠 + 최종 결과까지 트리 형태로 통합 표시합니다.
 *
 * renderResult는 빈 컴포넌트를 반환하여 중복 표시를 방지합니다.
 * 히스토리 복원(세션 리로드)은 globalThis 결과 캐시로 대응합니다.
 *
 * 등록 시 각 carrier의 프롬프트 메타데이터를 framework에서 읽어
 * promptGuidelines에 동적으로 합성합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import { Type } from "@sinclair/typebox";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { runAgentRequest } from "../../operation-runner.js";
import { getVisibleRun } from "../../internal/streaming/stream-store.js";
import { renderBlockLines, blockLineAnsiColor } from "../../internal/render/block-renderer.js";
import {
  getRegisteredOrder,
  getSortieEnabledIds,
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
  FLEET_SORTIE_PROMPT_SNIPPET,
  FLEET_SORTIE_PROMPT_GUIDELINES,
  buildCarrierGuidelines,
} from "./prompts.js";

// ─── 상수 ────────────────────────────────────────────────

/** Carrier당 최대 콘텐츠 라인 수 (tail 방식으로 최근 N줄만 표시) */
const MAX_CONTENT_LINES = 6;

// ─── 타입 ────────────────────────────────────────────────

/** Carrier 배정 항목 (도구 파라미터) */
interface CarrierAssignment {
  carrier: string;
  request: string;
}

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

/** carrier_sortie 도구 결과 details */
interface SortieResultDetails {
  results: CarrierSortieResult[];
}

/** renderCall에서 사용하는 최소 컨텍스트 */
interface SortieRenderContext {
  invalidate?: () => void;
  lastComponent?: unknown;
}

// ─── globalThis 진행 상태 (renderCall에서 참조) ────────────

const SORTIE_STATE_KEY = "__pi_carrier_sortie_state__";
/** 히스토리 복원용 결과 캐시 키 */
const SORTIE_RESULT_CACHE_KEY = "__pi_carrier_sortie_result_cache__";

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
  /** carrierId → 진행 상태 */
  carriers: Map<string, CarrierProgress>;
  /** 애니메이션 프레임 카운터 */
  frame: number;
  /** 프레임 타이머 */
  timer: ReturnType<typeof setInterval> | null;
}

function getSortieState(): SortieState | null {
  return (globalThis as any)[SORTIE_STATE_KEY] ?? null;
}

function initSortieState(carrierIds: string[]): SortieState {
  const state: SortieState = {
    carriers: new Map(
      carrierIds.map((id) => [id, { status: "queued", toolCallCount: 0, lineCount: 0 }]),
    ),
    frame: 0,
    timer: null,
  };
  // 애니메이션 프레임 카운터 (100ms)
  state.timer = setInterval(() => { state.frame++; }, 100);
  (globalThis as any)[SORTIE_STATE_KEY] = state;
  return state;
}

function clearSortieState(): void {
  const state = getSortieState();
  if (state?.timer) clearInterval(state.timer);
  (globalThis as any)[SORTIE_STATE_KEY] = null;
}

/** 결과 캐시 저장 (renderResult → renderCall 히스토리 복원용) */
function setResultCache(results: CarrierSortieResult[]): void {
  (globalThis as any)[SORTIE_RESULT_CACHE_KEY] = results;
}

/** 결과 캐시 읽기 */
function getResultCache(): CarrierSortieResult[] | null {
  return (globalThis as any)[SORTIE_RESULT_CACHE_KEY] ?? null;
}

// ─── 렌더링 헬퍼 ──────────────────────────────────────────

/**
 * carrier_sortie의 renderCall 전용 컴포넌트입니다.
 * 동일 인스턴스를 재사용해 렌더 상태를 유지하고,
 * 완료 직후 한 프레임 동안만 이전 높이를 보존해 compact 전환을 안정화합니다.
 */
class SortieCallComponent {
  private entries: CarrierAssignment[] = [];
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
      !this.hasStreamingCarrier() &&
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

  private hasStreamingCarrier(): boolean {
    const state = getSortieState();
    if (!state) return false;
    return this.entries.some((entry) => {
      const progress = entry?.carrier ? state.carriers.get(entry.carrier) : undefined;
      return progress?.status === "connecting" || progress?.status === "streaming";
    });
  }

  private buildLines(width: number): string[] {
    const state = getSortieState();
    const cachedResults = getResultCache();
    const frame = state?.frame ?? 0;
    const count = this.entries.length;
    const lines: string[] = [];

    // ── 헤더: 진행 상태 요약 ──
    const headerTitle = this.theme.fg("toolTitle", this.theme.bold("◈ Carrier Sortie"));
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
    lines.push(`${headerTitle} ${this.theme.fg("dim", `· ${headerSuffix}`)}`);

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
            Math.max(0, width - 20 - visibleWidth(displayName)),
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
        const contentLines = renderCarrierContentLines(carrierId, connector, width, this.theme);
        for (const cl of contentLines) {
          lines.push(cl);
        }
      }
    }

    return lines.map((line) => visibleWidth(line) > width ? truncateToWidth(line, width) : line);
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
  connector: string,
  contentWidth: number,
  _theme: any,
): string[] {
  const run = getVisibleRun(carrierId);
  if (!run || run.blocks.length === 0) return [];

  const blockLines = renderBlockLines(run.blocks);
  if (blockLines.length === 0) return [];

  // tail 방식: 마지막 MAX_CONTENT_LINES줄만 사용
  const tail = blockLines.slice(-MAX_CONTENT_LINES);
  const indent = `  ${PANEL_DIM_COLOR}${connector}${ANSI_RESET}    `;

  return tail.map((bl) => {
    const colorPrefix = blockLineAnsiColor(bl.type);
    const coloredText = colorPrefix ? `${colorPrefix}${bl.text}${ANSI_RESET}` : bl.text;
    const truncated = truncateToWidth(`${indent}${coloredText}`, contentWidth);
    return truncated;
  });
}

// ─── 공개 API ────────────────────────────────────────────

/**
 * carrier_sortie 도구를 PI에 등록합니다.
 * index.ts에서 호출됩니다.
 */
export function registerFleetSortie(pi: ExtensionAPI): void {
  const allCarriers = getRegisteredOrder();
  if (allCarriers.length < 1) return; // Carrier가 없으면 등록 불필요

  // sortie 가용 carrier만 프롬프트/파라미터에 반영
  const enabledIds = getSortieEnabledIds();

  // 모든 carrier가 비활성이어도 도구 자체는 등록 (execute guard가 거부)
  const carrierGuidelines = buildCarrierGuidelines(enabledIds);
  const mergedGuidelines = [
    ...FLEET_SORTIE_PROMPT_GUIDELINES,
    ...carrierGuidelines,
  ];

  const availableDesc = enabledIds.length > 0
    ? `Carrier ID to sortie. Available: ${enabledIds.join(", ")}`
    : "Carrier ID to sortie. (No carriers currently available)";

  pi.registerTool({
    name: "carrier_sortie",
    label: "Carrier Sortie",
    description: FLEET_SORTIE_DESCRIPTION,
    promptSnippet: FLEET_SORTIE_PROMPT_SNIPPET,
    promptGuidelines: mergedGuidelines,
    parameters: Type.Object({
      carriers: Type.Array(
        Type.Object({
          carrier: Type.String({
            description: availableDesc,
          }),
          request: Type.String({
            description: "The task/prompt to send to this carrier",
          }),
        }),
        {
          minItems: 1,
          description: "Array of carrier assignments (1 or more)",
        },
      ),
    }),

    // ── renderCall: 스트리밍 콘텐츠 + 최종 결과까지 통합 표시 ──
    renderCall(args: { carriers?: CarrierAssignment[] }, theme: any, context?: SortieRenderContext) {
      const entries = args.carriers ?? [];
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
      if (details?.results) {
        setResultCache(details.results);
      }
      // 빈 컴포넌트 — renderCall이 모든 상태를 통합 표시
      return { render() { return []; }, invalidate() {} };
    },

    // ── execute: N개 Carrier 병렬 실행 ──
    async execute(
      _id: string,
      params: { carriers: CarrierAssignment[] },
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: ExtensionContext,
    ) {
      const assignments = params.carriers;
      if (!assignments || assignments.length < 1) {
        throw new Error("carrier_sortie requires at least 1 carrier assignment.");
      }

      // Carrier ID 유효성 검증
      const allIds = new Set(getRegisteredOrder());
      const enabledIds = new Set(getSortieEnabledIds());
      for (const a of assignments) {
        if (!allIds.has(a.carrier)) {
          // 미등록 carrier — 등록된 전체 목록을 표시하여 LLM이 올바른 ID를 파악하도록 함
          const registered = [...allIds].join(", ") || "(none)";
          throw new Error(`Unknown carrier: "${a.carrier}". Registered carriers: ${registered}`);
        }
        // sortie 비활성 carrier 가드 — throw 대신 content로 에러 반환하여 LLM이 재시도 가능
        if (!enabledIds.has(a.carrier)) {
          const available = [...enabledIds].join(", ") || "(none)";
          return {
            content: [{ type: "text" as const, text: `Carrier "${a.carrier}" is currently disabled for sortie. Available carriers: ${available}` }],
            details: { results: [] },
          };
        }
      }

      // 중복 carrier 검증
      const seen = new Set<string>();
      for (const a of assignments) {
        if (seen.has(a.carrier)) {
          throw new Error(`Duplicate carrier: "${a.carrier}". Each carrier can only be assigned once.`);
        }
        seen.add(a.carrier);
      }

      // 진행 상태 초기화
      const state = initSortieState(assignments.map((a) => a.carrier));

      // 진행률 업데이트 타이머 (200ms 간격으로 onUpdate 호출)
      const updateTimer = setInterval(() => {
        if (!onUpdate) return;
        const partial = buildPartialUpdate(state, assignments);
        onUpdate(partial);
      }, 200);

      try {
        // N개 Carrier 병렬 실행
        const settledResults = await Promise.allSettled(
          assignments.map(async (a) => {
            const progress = state.carriers.get(a.carrier)!;
            progress.status = "connecting";

            const cliType = getRegisteredCarrierConfig(a.carrier)?.cliType ?? a.carrier;
            const result = await runAgentRequest({
              cli: cliType as CliType,
              carrierId: a.carrier,
              request: a.request,
              ctx,
              signal,
              onMessageChunk: () => {
                progress.status = "streaming";
                progress.lineCount++;
              },
              onToolCall: () => {
                progress.status = "streaming";
                progress.toolCallCount++;
              },
            });

            progress.status = result.status === "done" ? "done" : "error";
            return {
              carrierId: a.carrier,
              displayName: resolveCarrierDisplayName(a.carrier),
              status: result.status,
              responseText: result.responseText || "(no output)",
              sessionId: result.sessionId,
              error: result.error,
              thinking: result.thinking,
              toolCalls: result.toolCalls,
            } as CarrierSortieResult;
          }),
        );

        // 결과 수집
        const results: CarrierSortieResult[] = settledResults.map((settled, i) => {
          if (settled.status === "fulfilled") return settled.value;
          // reject된 경우 에러 결과 생성
          const errorMessage = settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
          return {
            carrierId: assignments[i].carrier,
            displayName: resolveCarrierDisplayName(assignments[i].carrier),
            status: "error" as const,
            responseText: `Error: ${errorMessage}`,
            error: errorMessage,
          };
        });

        // 결과 캐시에 저장 (renderCall이 완료 후에도 참조 가능하도록)
        setResultCache(results);

        // LLM에 전달할 텍스트 요약
        const contentText = results
          .map((r) => `[${r.displayName}] (${r.status})\n${r.responseText}`)
          .join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: contentText }],
          details: { results } satisfies SortieResultDetails,
        };
      } finally {
        clearInterval(updateTimer);
        clearSortieState();
      }
    },
  });
}

// ─── 내부 헬퍼 ──────────────────────────────────────────

/** onUpdate용 partial result 생성 */
function buildPartialUpdate(
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
    content: [{ type: "text", text: `Carrier Sortie: ${doneCount}/${total} carriers completed` }],
    details: { results },
  };
}
