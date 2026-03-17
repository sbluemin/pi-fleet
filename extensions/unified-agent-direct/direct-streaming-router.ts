/**
 * unified-agent-direct — 스트리밍 출력 라우터
 *
 * 패널 상태에 따라 스트리밍 출력을 동적으로 라우팅합니다:
 * - 패널 펼침 → 패널 칼럼에만 반영 (panelMirror)
 * - 패널 접힘 → 패널 칼럼 + 독립 aboveEditor 합성 위젯 동시 반영
 *
 * 동시 실행되는 여러 CLI 스트림을 하나의 위젯(하나의 타이머)으로
 * 합성 렌더링하여 깜빡임을 방지합니다.
 */

import type { CliType } from "@sbluemin/unified-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentStatus, ExecuteResult } from "../unified-agent-core/types";
import type { StreamState } from "../unified-agent-tools/renderer";
import { renderStream } from "../unified-agent-tools/renderer";
import { ANIM_INTERVAL_MS } from "./constants";
import { createDirectPanelMirror } from "./direct-panel-mirror";
import { isAgentPanelExpanded, onPanelToggle } from "./agent-panel";

// ─── 합성 위젯 매니저 (globalThis 싱글턴) ────────────────

const MANAGER_KEY = "__pi_direct_stream_manager__";
const WIDGET_KEY = "ua-direct-stream";

interface DirectStreamManager {
  /** CLI별 스트림 상태 */
  streams: Map<string, StreamState>;
  /** 공유 애니메이션 타이머 */
  timer: ReturnType<typeof setInterval> | null;
  /** 공유 프레임 카운터 */
  frame: number;
  /** 위젯 갱신에 사용할 ctx */
  ctx: ExtensionContext | null;
}

function getManager(): DirectStreamManager {
  let m = (globalThis as any)[MANAGER_KEY] as DirectStreamManager | undefined;
  if (!m) {
    m = { streams: new Map(), timer: null, frame: 0, ctx: null };
    (globalThis as any)[MANAGER_KEY] = m;
  }
  return m;
}

/** 합성 위젯을 갱신합니다. 등록된 모든 스트림을 세로로 연결 렌더링. */
function syncCompositeWidget(mgr: DirectStreamManager): void {
  if (!mgr.ctx) return;
  const ctx = mgr.ctx;

  if (mgr.streams.size === 0) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  ctx.ui.setWidget(WIDGET_KEY, (_tui: any, theme: any) => ({
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
function ensureTimer(mgr: DirectStreamManager): void {
  if (mgr.timer) return;
  mgr.timer = setInterval(() => {
    mgr.frame++;
    syncCompositeWidget(mgr);
  }, ANIM_INTERVAL_MS);
}

/** 스트림이 없으면 타이머를 정지하고 위젯을 제거합니다. */
function cleanupIfEmpty(mgr: DirectStreamManager): void {
  if (mgr.streams.size > 0) return;
  if (mgr.timer) {
    clearInterval(mgr.timer);
    mgr.timer = null;
  }
  if (mgr.ctx) {
    mgr.ctx.ui.setWidget(WIDGET_KEY, undefined);
  }
}

/** 매니저에 스트림을 등록합니다. */
function registerStream(ctx: ExtensionContext, cli: string): StreamState {
  const mgr = getManager();
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
  ensureTimer(mgr);
  syncCompositeWidget(mgr);
  return state;
}

/** 매니저에서 스트림을 해제합니다. */
function unregisterStream(cli: string): void {
  const mgr = getManager();
  mgr.streams.delete(cli);
  cleanupIfEmpty(mgr);
  if (mgr.streams.size > 0) syncCompositeWidget(mgr);
}

// ─── 라우터 공개 API ──────────────────────────────────────

export function createDirectStreamingRouter(ctx: ExtensionContext, cli: CliType) {
  const panelMirror = createDirectPanelMirror(ctx, cli);

  // 누적 상태 (패널 토글 시 합성 위젯에 리플레이)
  let accText = "";
  let accThinking = "";
  const accToolCalls: { title: string; status: string }[] = [];
  let lastStatus: AgentStatus = "connecting";

  let streamState: StreamState | null = null;
  let unsubToggle: (() => void) | null = null;

  function activateWidget() {
    if (streamState) return;
    streamState = registerStream(ctx, cli);
    // 누적 데이터 리플레이
    if (accThinking) streamState.thinkingText = accThinking;
    for (const tc of accToolCalls) {
      const existing = streamState.toolCalls.find((t) => t.title === tc.title);
      if (existing) existing.status = tc.status;
      else streamState.toolCalls.push({ ...tc });
    }
    if (accText) streamState.responseText = accText;
    streamState.agentStatus = lastStatus;
  }

  function deactivateWidget() {
    if (!streamState) return;
    unregisterStream(cli);
    streamState = null;
  }

  function handleToggle(expanded: boolean) {
    if (expanded) {
      deactivateWidget();
    } else {
      activateWidget();
    }
  }

  return {
    start() {
      panelMirror.start();
      if (!isAgentPanelExpanded()) {
        activateWidget();
      }
      unsubToggle = onPanelToggle(handleToggle);
    },

    onStatusChange(status: AgentStatus) {
      lastStatus = status;
      panelMirror.onStatusChange(status);
      if (streamState) streamState.agentStatus = status;
    },

    onMessageChunk(text: string) {
      accText += text;
      panelMirror.onMessageChunk(text);
      if (streamState) streamState.responseText += text;
    },

    onThoughtChunk(text: string) {
      accThinking += text;
      panelMirror.onThoughtChunk(text);
      if (streamState) streamState.thinkingText += text;
    },

    onToolCall(title: string, status: string) {
      const existing = accToolCalls.find((tc) => tc.title === title);
      if (existing) existing.status = status;
      else accToolCalls.push({ title, status });

      panelMirror.onToolCall(title, status);
      if (streamState) {
        const stExisting = streamState.toolCalls.find((tc) => tc.title === title);
        if (stExisting) stExisting.status = status;
        else streamState.toolCalls.push({ title, status });
      }
    },

    finish(result: ExecuteResult) {
      panelMirror.finish(result);
      if (streamState) streamState.agentStatus = "done";
    },

    fail(error: string) {
      panelMirror.fail(error);
      if (streamState) streamState.agentStatus = "error";
    },

    stop() {
      panelMirror.stop();
      deactivateWidget();
      if (unsubToggle) {
        unsubToggle();
        unsubToggle = null;
      }
    },
  };
}
