/**
 * fleet/panel/lifecycle.ts — 에이전트 패널 라이프사이클 API
 *
 * 스트리밍 시작/종료, 패널 토글, 상세 뷰, 칼럼 업데이트 등
 * 외부에서 호출하는 모든 패널 조작 API를 제공합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { ANIM_INTERVAL_MS, formatPanelMultiColHint, PANEL_DETAIL_HINT } from "../../constants.js";
import { getState, makeCols, syncColsWithRegisteredOrder } from "./state.js";
import type { AgentCol } from "./types.js";
import { syncWidget } from "./widget-sync.js";

// 편의를 위한 re-export
export type { AgentCol } from "./types.js";

// ─── 패널 상세 뷰 관리 ──────────────────────────────────

/**
 * 패널 로컬 상세 뷰를 설정합니다.
 * carrierId를 지정하면 해당 carrier의 1칼럼 상세 뷰로 전환합니다.
 * null이면 N칼럼 멀티 뷰로 복귀합니다.
 */
export function setDetailView(
  ctx: ExtensionContext,
  carrierId: string | null,
): void {
  const s = getState();
  s.detailCarrierId = carrierId;

  if (carrierId === null) {
    s.bottomHint = formatPanelMultiColHint();
  } else {
    s.bottomHint = PANEL_DETAIL_HINT;
  }

  syncWidget(ctx);
}

/** 현재 상세 뷰 대상 carrier ID를 반환합니다. (null = N칼럼) */
export function getDetailCarrierId(): string | null {
  return getState().detailCarrierId;
}

// ─── 스트리밍 라이프사이클 ───────────────────────────────

/**
 * 스트리밍을 종료합니다.
 * 애니메이션 타이머를 정지하고 위젯을 최종 상태로 갱신합니다.
 * expanded가 true이면 패널은 최종 결과를 정적으로 표시합니다.
 */
export function stopAgentStreaming(ctx: ExtensionContext): void {
  const s = getState();
  s.streaming = false;

  if (s.animTimer) {
    clearInterval(s.animTimer);
    s.animTimer = null;
  }

  syncWidget(ctx);
}

// ─── UI 토글 ─────────────────────────────────────────────

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

/** 패널이 펼쳐져 있는지 반환합니다. */
export function isAgentPanelExpanded(): boolean {
  return getState().expanded;
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
    if (s.lastCtx) syncWidget(s.lastCtx);
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

  if (s.animTimer) {
    clearInterval(s.animTimer);
    s.animTimer = null;
  }

  syncWidget(ctx);
}

// ─── 패널 갱신 ──────────────────────────────────────────

/** 패널 상태를 현재 기준으로 즉시 동기화합니다. */
export function refreshAgentPanel(ctx: ExtensionContext): void {
  const s = getState();
  s.lastCtx = ctx;
  syncColsWithRegisteredOrder();
  syncWidget(ctx);
}

// ─── 개별 칼럼 스트리밍 (Carrier용) ─────────────────────

/**
 * 개별 CLI의 스트리밍을 시작합니다.
 * 해당 칼럼만 초기화하고 다른 칼럼의 기존 데이터는 보존합니다.
 */
export function beginColStreaming(ctx: ExtensionContext, colIndex: number): void {
  const s = getState();
  s.lastCtx = ctx;
  s.streaming = true;

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
    if (s.animTimer) {
      clearInterval(s.animTimer);
      s.animTimer = null;
    }
  }

  syncWidget(ctx);
}

// ─── UI 토글 헬퍼 ────────────────────────────────────────

/** 등록된 토글 리스너에 expanded 상태를 전파합니다. */
function notifyToggle(expanded: boolean): void {
  const s = getState();
  for (const cb of s.toggleCallbacks) {
    try { cb(expanded); } catch { /* 리스너 에러 무시 */ }
  }
}
