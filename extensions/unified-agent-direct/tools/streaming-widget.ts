/**
 * unified-agent-direct/tools — 스트리밍 위젯 렌더러
 *
 * 도구 실행 중 aboveEditor 위젯으로 에이전트 응답을 실시간 표시합니다.
 * 100ms 애니메이션 타이머로 갱신하며, destroy() 시 위젯을 제거합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { AgentStatus } from "../../unified-agent-core/types";
import type { CollectedStreamData } from "../streaming/mirror";
import {
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
  CLI_DISPLAY_NAMES,
  SPINNER_FRAMES,
  ANIM_INTERVAL_MS,
  ANSI_RESET,
  STREAMING_PREVIEW_LINES,
  PREVIEW_LINES,
  SYM_INDICATOR,
  SYM_THINKING,
} from "../constants";

// ─── 스트리밍 위젯 상태 ──────────────────────────────────

export interface StreamState {
  responseText: string;
  thinkingText: string;
  toolCalls: { title: string; status: string }[];
  agentStatus: AgentStatus;
  frame: number;
  timer: ReturnType<typeof setInterval> | null;
}

// ─── 합성 위젯 매니저 (globalThis 싱글턴) ────────────────
//
// 여러 도구가 동시 실행될 때 개별 위젯/타이머 충돌로 인한
// 깜빡임을 방지합니다. 단일 위젯 + 단일 타이머로 합성 렌더링.

const TOOL_MANAGER_KEY = "__pi_tool_stream_manager__";
const TOOL_WIDGET_KEY = "ua-tool-stream";

interface ToolStreamManager {
  /** CLI별 스트림 상태 */
  streams: Map<string, StreamState>;
  /** 공유 애니메이션 타이머 */
  timer: ReturnType<typeof setInterval> | null;
  /** 공유 프레임 카운터 */
  frame: number;
  /** 위젯 갱신에 사용할 ctx */
  ctx: ExtensionContext | null;
}

function getToolManager(): ToolStreamManager {
  let m = (globalThis as any)[TOOL_MANAGER_KEY] as ToolStreamManager | undefined;
  if (!m) {
    m = { streams: new Map(), timer: null, frame: 0, ctx: null };
    (globalThis as any)[TOOL_MANAGER_KEY] = m;
  }
  return m;
}

/** 합성 위젯을 갱신합니다. */
function syncToolWidget(mgr: ToolStreamManager): void {
  if (!mgr.ctx) return;
  const ctx = mgr.ctx;

  if (mgr.streams.size === 0) {
    ctx.ui.setWidget(TOOL_WIDGET_KEY, undefined);
    return;
  }

  ctx.ui.setWidget(TOOL_WIDGET_KEY, (_tui: any, theme: any) => ({
    render(width: number): string[] {
      const allLines: string[] = [];
      let first = true;
      for (const [cli, state] of mgr.streams) {
        if (!first) allLines.push(""); // 스트림 간 구분선
        first = false;
        state.frame = mgr.frame;
        allLines.push(...renderStream(state, cli, width, theme));
      }
      return allLines;
    },
    invalidate() {},
  }));
}

/** 공유 타이머를 시작합니다 (이미 실행 중이면 무시). */
function ensureToolTimer(mgr: ToolStreamManager): void {
  if (mgr.timer) return;
  mgr.timer = setInterval(() => {
    mgr.frame++;
    syncToolWidget(mgr);
  }, ANIM_INTERVAL_MS);
}

/** 스트림이 없으면 타이머를 정지하고 위젯을 제거합니다. */
function cleanupToolIfEmpty(mgr: ToolStreamManager): void {
  if (mgr.streams.size > 0) return;
  if (mgr.timer) {
    clearInterval(mgr.timer);
    mgr.timer = null;
  }
  if (mgr.ctx) {
    mgr.ctx.ui.setWidget(TOOL_WIDGET_KEY, undefined);
  }
}

// ─── 공개 API ────────────────────────────────────────────

export interface StreamingWidget {
  onMessage(text: string): void;
  onThought(text: string): void;
  onToolCall(title: string, status: string): void;
  onStatus(status: AgentStatus): void;
  finish(): void;
  fail(error: string): void;
  destroy(): void;
  /** 누적된 스트리밍 데이터를 반환합니다. */
  getCollectedData(): CollectedStreamData;
}

/**
 * aboveEditor 합성 위젯으로 에이전트 실행 스트리밍을 표시합니다.
 * 여러 도구가 동시 실행되어도 단일 위젯/타이머로 합성 렌더링합니다.
 */
export function createStreamingWidget(
  ctx: ExtensionContext,
  cli: string,
): StreamingWidget {
  const mgr = getToolManager();
  mgr.ctx = ctx;

  const state: StreamState = {
    responseText: "",
    thinkingText: "",
    toolCalls: [],
    agentStatus: "connecting",
    frame: mgr.frame,
    timer: null, // 개별 타이머 미사용 — 매니저 공유 타이머
  };

  mgr.streams.set(cli, state);
  ensureToolTimer(mgr);
  syncToolWidget(mgr);

  return {
    onMessage(text) { state.responseText += text; },
    onThought(text) { state.thinkingText += text; },
    onToolCall(title, status) {
      const existing = state.toolCalls.find((tc) => tc.title === title);
      if (existing) existing.status = status;
      else state.toolCalls.push({ title, status });
    },
    onStatus(status) { state.agentStatus = status; },
    finish() { state.agentStatus = "done"; syncToolWidget(mgr); },
    fail(_error) { state.agentStatus = "error"; syncToolWidget(mgr); },
    destroy() {
      mgr.streams.delete(cli);
      cleanupToolIfEmpty(mgr);
      if (mgr.streams.size > 0) syncToolWidget(mgr);
    },
    getCollectedData(): CollectedStreamData {
      return {
        text: state.responseText,
        thinking: state.thinkingText,
        toolCalls: state.toolCalls.map((tc) => ({ ...tc })),
        lastStatus: state.agentStatus,
      };
    },
  };
}

// ─── 렌더링 ──────────────────────────────────────────────

export function renderStream(
  state: StreamState,
  cli: string,
  width: number,
  theme: any,
): string[] {
  const color = DIRECT_MODE_COLORS[cli] ?? "";
  const bgColor = DIRECT_MODE_BG_COLORS[cli] ?? "";
  const name = CLI_DISPLAY_NAMES[cli] ?? cli;
  const isRunning = state.agentStatus === "connecting" || state.agentStatus === "running";

  const lines: string[] = [];

  // ── 헤더: 아이콘 + 이름 ──
  const spinner = isRunning
    ? SPINNER_FRAMES[state.frame % SPINNER_FRAMES.length] + " "
    : "";
  const statusIcon = state.agentStatus === "done"
    ? theme.fg("success", SYM_INDICATOR)
    : state.agentStatus === "error"
      ? theme.fg("error", SYM_INDICATOR)
      : spinner;
  const nameStyled = color
    ? `${color}${theme.bold(name)}${ANSI_RESET}`
    : theme.bold(name);
  lines.push(`${statusIcon} ${nameStyled}`);
  lines.push("");

  // ── thinking (한 줄 프리뷰) ──
  if (state.thinkingText) {
    const firstLine = state.thinkingText.split("\n").find((l) => l.trim()) ?? "";
    const preview = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
    lines.push(theme.fg("dim", `${SYM_THINKING} ${preview}`));
    lines.push("");
  }

  // ── toolCalls (요약) ──
  if (state.toolCalls.length > 0) {
    const completed = state.toolCalls.filter((tc) => tc.status === "completed").length;
    lines.push(theme.fg("dim", `${SYM_INDICATOR} ${state.toolCalls.length} tools (${completed} done)`));
    lines.push("");
  }

  // ── 응답 텍스트 ──
  if (state.responseText.trim()) {
    const wrapped = wrapTextWithAnsi(state.responseText, width);

    if (isRunning) {
      // 스트리밍 중: 마지막 N줄 표시 (최신 내용 추적)
      const display = wrapped.length > STREAMING_PREVIEW_LINES
        ? wrapped.slice(-STREAMING_PREVIEW_LINES)
        : wrapped;
      lines.push(...display);
    } else {
      // 완료 후: 처음 PREVIEW_LINES줄 표시, 초과 시 마지막 줄을 ...으로 교체
      if (wrapped.length > PREVIEW_LINES) {
        lines.push(...wrapped.slice(0, PREVIEW_LINES - 1));
        lines.push("...");
      } else {
        lines.push(...wrapped);
      }
    }
  } else if (isRunning) {
    lines.push(theme.fg("dim", "waiting for response..."));
  }

  // ── 헤더/메타 라인을 터미널 너비로 truncate (응답은 이미 wrap됨) ──
  const truncated = lines.map((line) =>
    visibleWidth(line) > width ? truncateToWidth(line, width) : line,
  );

  // ── 배경색 래핑 ──
  if (!bgColor) return truncated;

  return truncated.map((line) => {
    const restored = line.replaceAll("\x1b[0m", "\x1b[0m" + bgColor);
    const vw = visibleWidth(restored);
    const pad = Math.max(0, width - vw);
    const result = bgColor + restored + " ".repeat(pad) + ANSI_RESET;
    // 안전장치: 배경색 래핑 후에도 너비 초과 방지
    return visibleWidth(result) > width ? truncateToWidth(result, width) : result;
  });
}
