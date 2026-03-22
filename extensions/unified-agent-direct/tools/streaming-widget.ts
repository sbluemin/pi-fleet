/**
 * unified-agent-direct/tools — 스트리밍 위젯 렌더러
 *
 * 도구 실행 중 aboveEditor 위젯으로 에이전트 응답을 실시간 표시합니다.
 * 100ms 애니메이션 타이머로 갱신하며, destroy() 시 위젯을 제거합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import type { AgentStatus } from "../../unified-agent-core/types";
import type { CollectedStreamData } from "../streaming/mirror";
import {
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
  CLI_DISPLAY_NAMES,
  SPINNER_FRAMES,
  ANIM_INTERVAL_MS,
  ANSI_RESET,
  PANEL_DIM_COLOR,
  SYM_INDICATOR,
  SYM_RESULT,
  SYM_THINKING,
  TOOLS_COLOR,
} from "../constants";
import type { ColBlock } from "../render/panel-renderer";

// ─── 스트리밍 위젯 상태 ──────────────────────────────────

export interface StreamState {
  responseText: string;
  thinkingText: string;
  toolCalls: { title: string; status: string; rawOutput?: string }[];
  blocks: ColBlock[];
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
  onToolCall(title: string, status: string, rawOutput?: string): void;
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
    blocks: [],
    agentStatus: "connecting",
    frame: mgr.frame,
    timer: null, // 개별 타이머 미사용 — 매니저 공유 타이머
  };

  mgr.streams.set(cli, state);
  ensureToolTimer(mgr);
  syncToolWidget(mgr);

  return {
    onMessage(text) {
      state.responseText += text;
      // blocks에 text 블록 추가/이어붙이기
      const last = state.blocks[state.blocks.length - 1];
      if (last?.type === "text") {
        last.text += text;
      } else {
        state.blocks.push({ type: "text", text });
      }
    },
    onThought(text) {
      state.thinkingText += text;
      const last = state.blocks[state.blocks.length - 1];
      if (last?.type === "thought") {
        last.text += text;
      } else {
        state.blocks.push({ type: "thought", text });
      }
    },
    onToolCall(title, status, rawOutput) {
      // toolCalls 업데이트 (하위 호환)
      const existing = state.toolCalls.find((tc) => tc.title === title);
      if (existing) {
        existing.status = status;
        if (rawOutput !== undefined) {
          existing.rawOutput = rawOutput;
        }
      } else {
        state.toolCalls.push({ title, status, rawOutput });
      }
      // blocks에 tool 블록 추가/업데이트
      const toolBlockIdx = state.blocks.findIndex(
        (b): b is Extract<ColBlock, { type: "tool" }> => b.type === "tool" && b.title === title,
      );
      if (toolBlockIdx >= 0) {
        const block = state.blocks[toolBlockIdx] as Extract<ColBlock, { type: "tool" }>;
        block.status = status;
        if (rawOutput !== undefined) block.rawOutput = rawOutput;
      } else {
        state.blocks.push({ type: "tool", title, status, rawOutput });
      }
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
        blocks: state.blocks.map((b) => ({ ...b })),
        lastStatus: state.agentStatus,
      };
    },
  };
}

// ─── 렌더링 ──────────────────────────────────────────────

/** 도구 결과 줄 접기 최대 줄 수 */
const MAX_RESULT_LINES = 4;

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

  // ── blocks 기반 렌더링 (패널 렌더러와 동일한 프리티 표기) ──
  if (state.blocks.length > 0) {
    for (const block of state.blocks) {
      if (block.type === "thought") {
        const trimmed = block.text.replace(/^\n+/, "");
        if (!trimmed) continue;
        trimmed.split("\n").forEach((line, i) => {
          lines.push(
            theme.fg(
              "dim",
              i === 0 ? `${SYM_THINKING} ${line}` : `  ${line}`,
            ),
          );
        });
      } else if (block.type === "text") {
        // 응답 텍스트: 첫 줄 ⏺ + 이후 줄 들여쓰기
        const trimmed = block.text.replace(/^\n+/, "");
        if (!trimmed) continue;
        trimmed.split("\n").forEach((line, i) => {
          lines.push(i === 0 ? `${SYM_INDICATOR} ${line}` : `  ${line}`);
        });
      } else {
        // 도구 블록: ⏺ 타이틀 + ⎿ rawOutput/status
        const isToolError = block.status === "failed" || block.status === "error";
        const titleText = `${SYM_INDICATOR} ${block.title}`;
        lines.push(
          isToolError
            ? theme.fg("error", titleText)
            : `${TOOLS_COLOR}${titleText}${ANSI_RESET}`,
        );

        const statusText = block.rawOutput?.trim()
          ? block.rawOutput
          : (block.status === "completed" || block.status === "failed" || block.status === "error"
            ? block.status
            : "");
        if (statusText) {
          const rawLines = statusText.split("\n");
          const displayLines = rawLines.length > MAX_RESULT_LINES
            ? rawLines.slice(0, MAX_RESULT_LINES - 1)
            : rawLines;
          const foldedCount = rawLines.length > MAX_RESULT_LINES
            ? rawLines.length - (MAX_RESULT_LINES - 1)
            : 0;

          for (let i = 0; i < displayLines.length; i++) {
            const prefix = i === 0 ? `  ${SYM_RESULT}  ` : "     ";
            lines.push(
              isToolError
                ? theme.fg("error", `${prefix}${displayLines[i]}`)
                : `${PANEL_DIM_COLOR}${prefix}${displayLines[i]}${ANSI_RESET}`,
            );
          }
          if (foldedCount > 0) {
            lines.push(`${PANEL_DIM_COLOR}     … +${foldedCount} lines${ANSI_RESET}`);
          }
        }
      }
    }
  } else if (isRunning) {
    // blocks가 아직 없으면 대기 메시지
    lines.push(theme.fg("dim", "waiting for response..."));
  }

  // ── 터미널 너비로 truncate ──
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
    return visibleWidth(result) > width ? truncateToWidth(result, width) : result;
  });
}
