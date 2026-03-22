/**
 * panel/lifecycle.ts — 에이전트 패널 라이프사이클 API
 *
 * 스트리밍 시작/종료, 패널 토글, 모드 설정, 칼럼 업데이트 등
 * 외부에서 호출하는 모든 패널 조작 API를 제공합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SessionMapStore } from "../../../unified-agent-core/session-map";
import { ANIM_INTERVAL_MS } from "../../constants";
import { resetRuns } from "../streaming/stream-store";
import { renderModeBanner } from "../render/panel-renderer";
import { getState, makeCols, syncColSessionIds } from "./state.js";
import type { AgentCol } from "./state.js";
import { syncWidget, syncFooterStatus } from "./widget-sync.js";

// 편의를 위한 re-export
export type { AgentCol } from "./state.js";

// ─── 패널 모드 관리 ──────────────────────────────────────

/**
 * 에이전트 패널의 활성 모드를 설정합니다.
 * 프레임워크의 모드 전환 시 호출되어 독점/3분할 레이아웃을 결정합니다.
 *
 * @param mode - CLI ID ("claude"/"codex"/"gemini"/"all") 또는 null (비활성)
 * @param options.bottomHint - 하단 보더 힌트 텍스트
 */
export function setAgentPanelMode(
  ctx: ExtensionContext,
  mode: string | null,
  options?: { bottomHint?: string },
): void {
  const s = getState();
  s.activeMode = mode;

  if (options?.bottomHint) {
    s.bottomHint = options.bottomHint;
  } else if (mode === null) {
    s.bottomHint = " alt+p toggle · j↑ k↓";
  }

  syncWidget(ctx);
}

/** 현재 활성 모드를 반환합니다. */
export function getAgentPanelMode(): string | null {
  return getState().activeMode;
}

// ─── 스트리밍 라이프사이클 ───────────────────────────────

/**
 * 스트리밍을 시작합니다.
 * 칼럼을 초기화하고 애니메이션 타이머를 가동합니다.
 *
 * @param ctx - 현재 ExtensionContext
 * @param options.expand - true이면 패널을 자동으로 펼침
 * @param options.clis - 커스텀 CLI 리스트 (기본: claude, codex, gemini)
 * @param options.showCompactWhenCollapsed - false이면 접힌 상태에서는 위젯을 숨기고 상태만 유지
 */
export function startAgentStreaming(
  ctx: ExtensionContext,
  options?: { expand?: boolean; clis?: readonly string[]; showCompactWhenCollapsed?: boolean },
): void {
  const s = getState();
  // store의 runs도 리셋하여 일관된 상태 유지
  resetRuns(options?.clis);
  s.cols = makeCols(options?.clis);
  s.streaming = true;
  s.showCompactWhenCollapsed = options?.showCompactWhenCollapsed ?? true;
  s.lastCtx = ctx;
  s.frame = 0;

  if (options?.expand) {
    s.expanded = true;
  }

  // 기존 타이머 정리
  if (s.animTimer) clearInterval(s.animTimer);

  // 애니메이션 타이머 시작 (100ms 간격으로 위젯 갱신)
  s.animTimer = setInterval(() => {
    s.frame++;
    syncWidget(ctx);
  }, ANIM_INTERVAL_MS);

  syncWidget(ctx);
}

/**
 * 스트리밍을 종료합니다.
 * 애니메이션 타이머를 정지하고 위젯을 최종 상태로 갱신합니다.
 * expanded가 true이면 패널은 최종 결과를 정적으로 표시합니다.
 */
export function stopAgentStreaming(ctx: ExtensionContext): void {
  const s = getState();
  s.streaming = false;
  s.showCompactWhenCollapsed = true;

  if (s.animTimer) {
    clearInterval(s.animTimer);
    s.animTimer = null;
  }

  syncWidget(ctx);
}

// ─── UI 토글 ─────────────────────────────────────────────

/** 등록된 토글 리스너에 expanded 상태를 전파합니다. */
function notifyToggle(expanded: boolean): void {
  const s = getState();
  for (const cb of s.toggleCallbacks) {
    try { cb(expanded); } catch { /* 리스너 에러 무시 */ }
  }
}

/** 패널을 펼칩니다. */
export function showAgentPanel(ctx: ExtensionContext): void {
  const s = getState();
  s.expanded = true;
  s.lastCtx = ctx;
  syncWidget(ctx);
  notifyToggle(true);
}

/** 패널을 접습니다. 스트리밍 중이면 컴팩트 뷰로 전환됩니다. */
export function hideAgentPanel(ctx: ExtensionContext): void {
  const s = getState();
  s.expanded = false;
  syncWidget(ctx);
  notifyToggle(false);
}

/** 패널 표시를 토글합니다. 반환값은 토글 후의 expanded 상태. */
export function toggleAgentPanel(ctx: ExtensionContext): boolean {
  const s = getState();
  s.expanded = !s.expanded;
  syncWidget(ctx);
  notifyToggle(s.expanded);
  return s.expanded;
}

/**
 * 패널 토글 리스너를 등록합니다.
 * 반환값을 호출하면 구독이 해제됩니다.
 */
export function onPanelToggle(callback: (expanded: boolean) => void): () => void {
  const s = getState();
  s.toggleCallbacks.push(callback);
  return () => {
    const idx = s.toggleCallbacks.indexOf(callback);
    if (idx >= 0) s.toggleCallbacks.splice(idx, 1);
  };
}

/**
 * 현재 모드 배너 라인을 반환합니다 (에디터 render에서 사용).
 * 패널이 접힌 상태에서 활성 모드가 있을 때만 배너를 반환합니다.
 */
export function getModeBannerLines(width: number): string[] {
  const s = getState();
  if (!s.activeMode || s.expanded) return [];
  return renderModeBanner(width, s.activeMode, s.frame, s.cols);
}

/** 패널이 펼쳐져 있는지 반환합니다. */
export function isAgentPanelExpanded(): boolean {
  return getState().expanded;
}

// ─── 개별 칼럼 스트리밍 (다이렉트 모드용) ─────────────────

/**
 * 개별 CLI의 스트리밍을 시작합니다.
 * startAgentStreaming과 달리 해당 칼럼만 초기화하고
 * 다른 칼럼의 기존 데이터는 보존합니다.
 */
export function beginColStreaming(ctx: ExtensionContext, colIndex: number): void {
  const s = getState();
  s.lastCtx = ctx;
  s.streaming = true;
  s.showCompactWhenCollapsed = false;

  // 해당 칼럼만 초기화
  if (colIndex >= 0 && colIndex < s.cols.length) {
    s.cols[colIndex] = {
      cli: s.cols[colIndex].cli,
      sessionId: s.cols[colIndex].sessionId,
      text: "",
      blocks: [],
      thinking: "",
      toolCalls: [],
      status: "conn",
      scroll: 0,
    };
  }

  // 타이머가 없으면 시작
  if (!s.animTimer) {
    s.animTimer = setInterval(() => {
      s.frame++;
      syncWidget(ctx);
    }, ANIM_INTERVAL_MS);
  }

  syncWidget(ctx);
}

/**
 * 개별 CLI의 스트리밍을 종료합니다.
 * 모든 칼럼이 완료 상태이면 전체 스트리밍을 종료합니다.
 */
export function endColStreaming(ctx: ExtensionContext, colIndex: number): void {
  const s = getState();

  // 다른 칼럼 중 아직 스트리밍 중인 게 있는지 확인
  const stillStreaming = s.cols.some(
    (col, i) => i !== colIndex && (col.status === "conn" || col.status === "stream"),
  );

  if (!stillStreaming) {
    s.streaming = false;
    s.showCompactWhenCollapsed = true;
    if (s.animTimer) {
      clearInterval(s.animTimer);
      s.animTimer = null;
    }
  }

  syncWidget(ctx);
}

// ─── 칼럼 업데이트 ───────────────────────────────────────

/**
 * 특정 칼럼의 데이터를 업데이트합니다.
 * 렌더링은 animTimer의 다음 tick에서 자동 반영됩니다.
 */
export function updateAgentCol(index: number, update: Partial<AgentCol>): void {
  const s = getState();
  if (index >= 0 && index < s.cols.length) {
    Object.assign(s.cols[index], update);
    syncFooterStatus(s.lastCtx);
  }
}

/** 현재 칼럼 배열을 반환합니다 (참조 — 직접 수정 주의). */
export function getAgentPanelCols(): AgentCol[] {
  return getState().cols;
}

/** 칼럼을 초기화하고 스트리밍을 중단합니다. */
export function resetAgentPanel(ctx: ExtensionContext): void {
  const s = getState();
  s.cols = makeCols();
  s.streaming = false;
  s.showCompactWhenCollapsed = true;

  if (s.animTimer) {
    clearInterval(s.animTimer);
    s.animTimer = null;
  }

  syncWidget(ctx);
}

// ─── 세션 스토어 주입 ─────────────────────────────────────

/** 세션 매핑 저장소를 패널 상태에 주입합니다. */
export function setAgentPanelSessionStore(store: SessionMapStore): void {
  getState().sessionStore = store;
}

// ─── Footer 갱신 ─────────────────────────────────────────

/** footer 상태를 현재 패널 상태 기준으로 즉시 동기화합니다. */
export function refreshAgentPanelFooter(ctx: ExtensionContext): void {
  const s = getState();
  s.lastCtx = ctx;
  syncColSessionIds();
  syncWidget(ctx);
}
