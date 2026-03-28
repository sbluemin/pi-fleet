/**
 * unified-agent-direct — 합성 위젯 매니저 (제네릭)
 *
 * router.ts의 DirectStreamManager와 streaming-widget.ts의 ToolStreamManager를
 * 단일 파라미터화된 팩토리로 통합합니다.
 *
 * 각 인스턴스는 고유한 globalThis 키와 위젯 키를 사용하여
 * 다이렉트 모드와 도구 실행 위젯을 독립적으로 관리합니다.
 *
 * 렌더링 시 stream-store에서 직접 데이터를 읽어 별도의 상태 사본을 유지하지 않습니다.
 *
 * ⚠️ globalThis 기반 — pi가 확장을 별도 번들로 로드하므로 필수.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { renderBlockLines } from "../render/block-renderer.js";
import { getRunById } from "./stream-store.js";
import {
  ANSI_RESET,
  ANIM_INTERVAL_MS,
  CLI_DISPLAY_NAMES,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
  PANEL_DIM_COLOR,
  SPINNER_FRAMES,
  SYM_INDICATOR,
  TOOLS_COLOR,
} from "../../constants.js";
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

// ─── 매니저 인터페이스 ───────────────────────────────────

/** 합성 위젯 매니저의 공개 API */
export interface StreamWidgetManager {
  /** 스트림을 등록합니다 (runId로 store의 특정 run을 참조). */
  register(ctx: ExtensionContext, cli: string, runId: string): void;
  /** 스트림을 해제합니다. */
  unregister(cli: string): void;
  /** 위젯을 강제 갱신합니다. */
  sync(): void;
  /** 모든 스트림을 제거하고 타이머를 정지합니다 (모드 종료/세션 전환용). */
  clearAll(): void;
}

// ─── 내부 싱글턴 구조 ────────────────────────────────────

interface ManagerState {
  /** cli → runId 매핑 (store에서 데이터를 읽기 위한 참조) */
  streams: Map<string, string>;
  timer: ReturnType<typeof setInterval> | null;
  frame: number;
  ctx: ExtensionContext | null;
  widgetKey: string;
}

// ─── 렌더링 ──────────────────────────────────────────────

/**
 * 단일 CLI 스트림을 렌더링합니다.
 * stream-store의 StreamRun에서 데이터를 읽고
 * block-renderer의 renderBlockLines()를 사용합니다.
 */
function renderStreamLines(
  cli: string,
  runId: string,
  frame: number,
  width: number,
  theme: any,
  toolsExpanded: boolean,
): string[] {
  const run = getRunById(runId);
  if (!run) return [];

  const color = DIRECT_MODE_COLORS[cli] ?? "";
  const bgColor = DIRECT_MODE_BG_COLORS[cli] ?? "";
  const name = CLI_DISPLAY_NAMES[cli] ?? cli;
  const agentStatus = run.lastAgentStatus;
  const isRunning = agentStatus === "connecting" || agentStatus === "running";

  const lines: string[] = [];

  // ── 헤더: 아이콘 + 이름 ──
  const spinner = isRunning
    ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length] + " "
    : "";
  const statusIcon = agentStatus === "done"
    ? theme.fg("success", SYM_INDICATOR)
    : agentStatus === "error"
      ? theme.fg("error", SYM_INDICATOR)
      : spinner;
  const nameStyled = color
    ? `${color}${theme.bold(name)}${ANSI_RESET}`
    : theme.bold(name);
  lines.push(`${statusIcon} ${nameStyled}`);
  lines.push("");

  // ── blocks 기반 렌더링 (block-renderer 사용) ──
  // toolsExpanded=false이면 tool/thought 블록을 제외하여 text만 표시
  const visibleBlocks = toolsExpanded
    ? run.blocks
    : run.blocks.filter((b) => b.type !== "tool" && b.type !== "thought");

  if (visibleBlocks.length > 0) {
    const blockLines = renderBlockLines(visibleBlocks);
    for (const bl of blockLines) {
      if (bl.type === "thought") {
        lines.push(theme.fg("dim", bl.text));
      } else if (bl.type === "tool-error") {
        lines.push(theme.fg("error", bl.text));
      } else if (bl.type === "tool-title") {
        lines.push(`${TOOLS_COLOR}${bl.text}${ANSI_RESET}`);
      } else if (bl.type === "tool-result" || bl.type === "fold") {
        lines.push(`${PANEL_DIM_COLOR}${bl.text}${ANSI_RESET}`);
      } else {
        lines.push(bl.text);
      }
    }
  } else if (isRunning) {
    lines.push(theme.fg("dim", "waiting for response..."));
  }

  // ── compact 모드 본문 줄 수 제한 (헤더 2줄 제외) ──
  if (!toolsExpanded) {
    const HEADER_LINES = 2;
    const MAX_BODY = 5;
    const bodyCount = lines.length - HEADER_LINES;
    if (bodyCount > MAX_BODY) {
      const body = lines.slice(HEADER_LINES);
      lines.length = HEADER_LINES;
      if (isRunning) {
        // 스트리밍 중: 마지막 5줄 표시 (tail)
        lines.push(...body.slice(-MAX_BODY));
      } else {
        // 완료/에러: 처음 5줄 + 잔여 힌트
        lines.push(...body.slice(0, MAX_BODY));
        lines.push(theme.fg("dim", `  ··· ${bodyCount - MAX_BODY} more lines`));
      }
    }
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
    const padW = Math.max(0, width - vw);
    return bgColor + restored + " ".repeat(padW) + ANSI_RESET;
  });
}

// ─── 팩토리 ──────────────────────────────────────────────

/**
 * 합성 위젯 매니저를 생성합니다.
 *
 * @param globalKey - globalThis에 저장할 싱글턴 키
 * @param widgetKey - ctx.ui.setWidget()에 사용할 위젯 키
 */
export function createStreamWidgetManager(
  globalKey: string,
  widgetKey: string,
): StreamWidgetManager {
  function getState(): ManagerState {
    let m = (globalThis as any)[globalKey] as ManagerState | undefined;
    if (!m) {
      m = { streams: new Map(), timer: null, frame: 0, ctx: null, widgetKey };
      (globalThis as any)[globalKey] = m;
    }
    return m;
  }

  function syncWidget(mgr: ManagerState): void {
    if (!mgr.ctx) return;
    const ctx = mgr.ctx;

    if (mgr.streams.size === 0) {
      ctx.ui.setWidget(mgr.widgetKey, undefined);
      return;
    }

    ctx.ui.setWidget(mgr.widgetKey, (_tui: any, theme: any) => ({
      render(width: number): string[] {
        // ctrl+o 토글 상태를 렌더링 시점에 읽어 즉시 반영
        const toolsExpanded = ctx.ui.getToolsExpanded();
        const allLines: string[] = [];
        let first = true;
        for (const [cli, runId] of mgr.streams) {
          if (!first) allLines.push("");
          first = false;
          allLines.push(...renderStreamLines(cli, runId, mgr.frame, width, theme, toolsExpanded));
        }
        return allLines;
      },
      invalidate() {},
    }));
  }

  /** 모든 스트림의 run이 완료 상태인지 확인합니다. */
  function allStreamsDone(mgr: ManagerState): boolean {
    for (const [, runId] of mgr.streams) {
      const run = getRunById(runId);
      if (!run) continue;
      const s = run.lastAgentStatus;
      if (s === "connecting" || s === "running") return false;
    }
    return true;
  }

  function ensureTimer(mgr: ManagerState): void {
    if (mgr.timer) return;
    mgr.timer = setInterval(() => {
      mgr.frame++;
      syncWidget(mgr);
      // 모든 스트림 완료 시 타이머 정지 (위젯은 유지 — pi repaint 시 render() 호출됨)
      if (mgr.streams.size > 0 && allStreamsDone(mgr)) {
        clearInterval(mgr.timer!);
        mgr.timer = null;
      }
    }, ANIM_INTERVAL_MS);
  }

  function cleanupIfEmpty(mgr: ManagerState): void {
    if (mgr.streams.size > 0) return;
    if (mgr.timer) {
      clearInterval(mgr.timer);
      mgr.timer = null;
    }
    if (mgr.ctx) {
      mgr.ctx.ui.setWidget(mgr.widgetKey, undefined);
    }
  }

  return {
    register(ctx, cli, runId) {
      const mgr = getState();
      mgr.ctx = ctx;
      mgr.streams.set(cli, runId);
      ensureTimer(mgr);
      syncWidget(mgr);
    },

    unregister(cli) {
      const mgr = getState();
      mgr.streams.delete(cli);
      cleanupIfEmpty(mgr);
      if (mgr.streams.size > 0) syncWidget(mgr);
    },

    sync() {
      syncWidget(getState());
    },

    clearAll() {
      const mgr = getState();
      mgr.streams.clear();
      if (mgr.timer) {
        clearInterval(mgr.timer);
        mgr.timer = null;
      }
      if (mgr.ctx) {
        mgr.ctx.ui.setWidget(mgr.widgetKey, undefined);
      }
    },
  };
}
