/**
 * unified-agent-direct — 에이전트 패널 상태 관리 + API
 *
 * 다이렉트 모드 활성 시 에이전트 패널을 통해 스트리밍을 표시합니다.
 * - 개별 CLI 활성 (alt+1/2/3): 독점 뷰 (해당 에이전트만 전체 폭)
 * - All 활성 (alt+0): 3분할 뷰 (기존)
 * - 패널 프레임 색상은 활성 에이전트에 맞게 변경
 *
 * All 모드 등 내부 모듈이 이 API를 호출하여
 * 패널의 표시/숨김 및 칼럼 데이터를 제어합니다.
 *
 * ⚠️ globalThis 기반이므로 확장 간 상태가 공유됩니다.
 */

import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@mariozechner/pi-tui";
import { UA_DIRECT_FOOTER_STATUS_KEY } from "../unified-agent-core/footer-status";
import type { SessionMapStore } from "../unified-agent-core/session-map";
import {
  ANIM_INTERVAL_MS,
  ANSI_RESET,
  CLI_DISPLAY_NAMES,
  DIRECT_MODE_COLORS,
  PANEL_COLOR,
  PANEL_DIM_COLOR,
  SPINNER_FRAMES,
  SYM_INDICATOR,
  DEFAULT_BODY_H,
  MIN_BODY_H,
  MAX_BODY_H,
  BODY_H_STEP,
} from "./constants";
import {
  renderPanelFull,
  renderPanelCompact,
  renderModeBanner,
  waveText,
  MODE_RGB,
} from "./render/panel-renderer";
import type { AgentCol } from "./render/panel-renderer";
import { renderServiceStatusToken } from "./status/ui.js";
import type { ServiceSnapshot } from "./status/types.js";

// 편의를 위한 re-export
export type { AgentCol } from "./render/panel-renderer";

// ─── 상수 ────────────────────────────────────────────────

const STATE_KEY = "__pi_agent_panel_state__";
const WIDGET_KEY = "ua-panel";
const OVERLAY_HOST_WIDGET_KEY = "ua-panel-overlay-host";
const DEFAULT_CLIS = ["claude", "codex", "gemini"];

// ─── globalThis 상태 ────────────────────────────────────

/** CLI별 모델/추론 설정 (footer 표시용) */
interface FooterModelInfo {
  model: string;
  effort?: string;
}

interface AgentPanelState {
  /** 각 에이전트의 칼럼 데이터 */
  cols: AgentCol[];
  /** 패널 펼침 여부 */
  expanded: boolean;
  /** 스트리밍 진행 중 여부 */
  streaming: boolean;
  /** 접힌 상태에서도 compact 상태바를 표시할지 여부 */
  showCompactWhenCollapsed: boolean;
  /** 애니메이션 프레임 카운터 */
  frame: number;
  /** 애니메이션 타이머 핸들 */
  animTimer: ReturnType<typeof setInterval> | null;
  /** 마지막으로 사용된 ctx (타이머 콜백에서 참조) */
  lastCtx: ExtensionContext | null;
  /** 현재 활성 모드 ("claude" | "codex" | "gemini" | "all" | null) */
  activeMode: string | null;
  /** 하단 보더 힌트 텍스트 */
  bottomHint: string;
  /** CLI별 모델/추론 설정 (footer 표시용) */
  modelConfig: Record<string, FooterModelInfo>;
  /** 서비스 상태 스냅샷 (Claude/Codex/Gemini) */
  serviceSnapshots: ServiceSnapshot[];
  /** 서비스 상태 마지막 갱신 시각 */
  serviceLastUpdatedAt: number | null;
  /** 서비스 상태 로딩 중 여부 */
  serviceLoading: boolean;
  /** 패널 토글 리스너 */
  toggleCallbacks: Array<(expanded: boolean) => void>;
  /** 세션 매핑 저장소 (호출처가 주입) */
  sessionStore: SessionMapStore | null;
  /** 패널 본문 높이 (줄 수) — 런타임 조절 가능 */
  bodyH: number;
  /** 오버레이를 소유하는 TUI 인스턴스 */
  overlayTui: TUI | null;
  /** 현재 오버레이 핸들을 만든 TUI 인스턴스 */
  overlayOwnerTui: TUI | null;
  /** 오버레이 핸들 */
  overlayHandle: OverlayHandle | null;
  /** 현재 오버레이 레이아웃 식별자 */
  overlayLayoutKey: string | null;
  /** 오버레이 호스트 위젯이 설치된 ctx */
  overlayHostCtx: ExtensionContext | null;
}

function getState(): AgentPanelState {
  let s = (globalThis as any)[STATE_KEY] as AgentPanelState | undefined;
  if (!s) {
    s = {
      cols: makeCols(),
      expanded: false,
      streaming: false,
      showCompactWhenCollapsed: true,
      frame: 0,
      animTimer: null,
      lastCtx: null,
      activeMode: null,
      bottomHint: " alt+p toggle · j↑ k↓",
      modelConfig: {},
      serviceSnapshots: [],
      serviceLastUpdatedAt: null,
      serviceLoading: false,
      toggleCallbacks: [],
      sessionStore: null,
      bodyH: DEFAULT_BODY_H,
      overlayTui: null,
      overlayOwnerTui: null,
      overlayHandle: null,
      overlayLayoutKey: null,
      overlayHostCtx: null,
    };
    (globalThis as any)[STATE_KEY] = s;
  }
  // 기존 상태에 새 필드가 없을 수 있으므로 마이그레이션
  if (s.activeMode === undefined) s.activeMode = null;
  if (s.bottomHint === undefined) s.bottomHint = " alt+p toggle · j↑ k↓";
  if (!s.modelConfig) s.modelConfig = {};
  if (!s.serviceSnapshots) s.serviceSnapshots = [];
  if (s.serviceLastUpdatedAt === undefined) s.serviceLastUpdatedAt = null;
  if (s.serviceLoading === undefined) s.serviceLoading = false;
  if (!s.toggleCallbacks) s.toggleCallbacks = [];
  if (s.sessionStore === undefined) s.sessionStore = null;
  if (s.bodyH === undefined) s.bodyH = DEFAULT_BODY_H;
  if (s.overlayTui === undefined) s.overlayTui = null;
  if (s.overlayOwnerTui === undefined) s.overlayOwnerTui = null;
  if (s.overlayHandle === undefined) s.overlayHandle = null;
  if (s.overlayLayoutKey === undefined) s.overlayLayoutKey = null;
  if (s.overlayHostCtx === undefined) s.overlayHostCtx = null;
  return s;
}

function makeCols(clis?: string[]): AgentCol[] {
  // getState()를 호출하면 상호 재귀가 발생하므로 globalThis에서 직접 읽음
  const existing = (globalThis as any)[STATE_KEY] as AgentPanelState | undefined;
  const store = existing?.sessionStore ?? null;
  const sessionMap = (store ? store.getAll() : {}) as Readonly<Record<string, string | undefined>>;
  return (clis ?? DEFAULT_CLIS).map((cli) => ({
    cli,
    sessionId: sessionMap[cli],
    text: "",
    thinking: "",
    toolCalls: [],
    status: "wait" as const,
    scroll: 0,
  }));
}

function syncColSessionIds(): void {
  const s = getState();
  const store = s.sessionStore;
  const sessionMap = (store ? store.getAll() : {}) as Readonly<Record<string, string | undefined>>;

  for (const col of s.cols) {
    col.sessionId = sessionMap[col.cli];
  }
}

function footerIcon(col: AgentCol, frame: number): string {
  const cliColor = DIRECT_MODE_COLORS[col.cli] ?? PANEL_COLOR;
  const icon = col.status === "done"
    ? SYM_INDICATOR
    : col.status === "err"
      ? SYM_INDICATOR
      : col.status === "conn" || col.status === "stream"
        ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
        : "○";
  return `${cliColor}${icon}${ANSI_RESET}`;
}

function footerDetail(col: AgentCol): string {
  if (col.status === "conn") return " connecting";
  if (col.status === "done") return " done";
  if (col.status === "err") return " error";
  if (col.status === "wait") return " idle";
  if (col.status !== "stream") return "";

  const parts: string[] = [];
  if (col.toolCalls.length > 0) parts.push(`${col.toolCalls.length}T`);

  const lineCount = col.text.trim() ? col.text.split("\n").length : 0;
  if (lineCount > 0) parts.push(`${lineCount}L`);

  if (parts.length === 0 && col.thinking.trim()) {
    return " thinking";
  }
  if (parts.length === 0) {
    return " running";
  }
  return ` ${parts.join("·")}`;
}

function footerSessionId(sessionId?: string): string {
  const display = sessionId?.slice(0, 8) ?? "new";
  return `${PANEL_DIM_COLOR} · ${display}${ANSI_RESET}`;
}

function renderFooterStatus(state: AgentPanelState): string | undefined {
  const segments = state.cols.map((col) => {
    const footerCol = state.streaming ? col : { ...col, status: "wait" as const };
    const cliColor = DIRECT_MODE_COLORS[col.cli] ?? PANEL_COLOR;
    const name = CLI_DISPLAY_NAMES[col.cli] ?? col.cli;
    const detail = footerDetail(footerCol);
    const serviceStatus = renderServiceStatusToken(
      col.cli as ServiceSnapshot["provider"],
      state.serviceSnapshots,
      state.serviceLoading,
    );

    // 모델/effort 정보
    const sel = state.modelConfig[col.cli];
    let modelSuffix = "";
    if (sel?.model) {
      const effortText = sel.effort && sel.effort !== "none"
        ? ` · ${sel.effort.charAt(0).toUpperCase()}${sel.effort.slice(1)}`
        : "";
      modelSuffix = `${PANEL_DIM_COLOR} (${sel.model}${effortText})${ANSI_RESET}`;
    }

    const isStreaming = footerCol.status === "conn" || footerCol.status === "stream";
    // 스트리밍 중: 아이콘 유지 + 이름에 파도 그라데이션
    const namePrefix = isStreaming
      ? `${footerIcon(footerCol, state.frame)} ${waveText(name, MODE_RGB[col.cli] ?? [180, 160, 220], state.frame)}${ANSI_RESET}`
      : `${footerIcon(footerCol, state.frame)} ${cliColor}${name}${ANSI_RESET}`;

    return `${namePrefix}${serviceStatus ?? ""}${modelSuffix}${
      footerSessionId(footerCol.sessionId)
    }${
      detail ? `${PANEL_DIM_COLOR}${detail}${ANSI_RESET}` : ""
    }`;
  });

  if (segments.length === 0) return undefined;
  return segments.join(`${PANEL_DIM_COLOR} │ ${ANSI_RESET}`);
}

function syncFooterStatus(ctx: ExtensionContext | null): void {
  if (!ctx) return;
  const content = renderFooterStatus(getState());
  ctx.ui.setStatus(UA_DIRECT_FOOTER_STATUS_KEY, content);
}

function getPanelFrameColor(activeMode: string | null): string {
  return activeMode ? (DIRECT_MODE_COLORS[activeMode] ?? PANEL_COLOR) : PANEL_COLOR;
}

function buildOverlayOptions(_state: AgentPanelState): OverlayOptions {
  return {
    nonCapturing: true,
    anchor: "center",
    width: "85%",
    maxHeight: "85%",
    margin: 1,
  };
}

function getOverlayLayoutKey(options: OverlayOptions): string {
  return JSON.stringify({
    anchor: options.anchor ?? "center",
    width: options.width ?? "auto",
    maxHeight: options.maxHeight ?? "auto",
    margin: options.margin ?? 0,
  });
}

function createPanelOverlayComponent(): Component {
  return {
    render(width: number): string[] {
      const state = getState();
      return renderPanelFull(
        width,
        state.cols,
        state.frame,
        getPanelFrameColor(state.activeMode),
        state.bottomHint,
        state.activeMode,
        state.bodyH,
      );
    },
    invalidate() {},
  };
}

function syncPanelOverlay(tui?: TUI | null): void {
  const s = getState();

  if (tui) {
    s.overlayTui = tui;
  }

  if (!s.expanded) {
    if (s.overlayHandle && !s.overlayHandle.isHidden()) {
      s.overlayHandle.setHidden(true);
      s.overlayTui?.requestRender();
    }
    return;
  }

  const overlayTui = s.overlayTui;
  if (!overlayTui) return;

  const options = buildOverlayOptions(s);
  const layoutKey = getOverlayLayoutKey(options);
  const needsRecreate = !s.overlayHandle
    || s.overlayLayoutKey !== layoutKey
    || s.overlayOwnerTui !== overlayTui;

  if (needsRecreate && s.overlayHandle) {
    s.overlayHandle.hide();
    s.overlayHandle = null;
  }

  if (!s.overlayHandle) {
    s.overlayHandle = overlayTui.showOverlay(createPanelOverlayComponent(), options);
    s.overlayOwnerTui = overlayTui;
    s.overlayLayoutKey = layoutKey;
  } else {
    s.overlayOwnerTui = overlayTui;
    s.overlayLayoutKey = layoutKey;
    if (s.overlayHandle.isHidden()) {
      s.overlayHandle.setHidden(false);
    }
  }

  overlayTui.requestRender();
}

function ensureOverlayHostWidget(ctx: ExtensionContext): void {
  const s = getState();
  if (s.overlayHostCtx === ctx) return;

  ctx.ui.setWidget(OVERLAY_HOST_WIDGET_KEY, (tui) => {
    const state = getState();
    state.overlayTui = tui;
    syncPanelOverlay(tui);

    return {
      render(): string[] {
        return [];
      },
      invalidate() {
        const nextState = getState();
        nextState.overlayTui = tui;
        syncPanelOverlay(tui);
      },
    };
  });

  s.overlayHostCtx = ctx;
}

/** footer 상태를 현재 패널 상태 기준으로 즉시 동기화합니다. */
export function refreshAgentPanelFooter(ctx: ExtensionContext): void {
  const s = getState();
  s.lastCtx = ctx;
  syncColSessionIds();
  syncWidget(ctx);
}

// ─── 위젯 동기화 ────────────────────────────────────────

/**
 * 현재 상태에 맞게 aboveEditor 위젯을 등록/제거합니다.
 *
 * 렌더링 분기:
 * - expanded → nonCapturing overlay로 renderPanelFull 표시
 * - !expanded + activeMode → 위젯 제거 (배너는 hud-editor/editor.ts에서 직접 렌더링)
 * - !expanded + streaming → 컴팩트 상태바 (renderPanelCompact)
 * - 그 외 → 위젯 제거
 */
function syncWidget(ctx: ExtensionContext): void {
  const s = getState();
  syncFooterStatus(ctx);

  // expanded 상태는 nonCapturing 오버레이로 렌더링하고, compact 위젯만 기존 키를 유지
  if (s.expanded) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    ensureOverlayHostWidget(ctx);
    syncPanelOverlay();
    return;
  }

  syncPanelOverlay();

  // 패널 접힘 + 활성 모드 → 배너는 에디터가 직접 렌더링하므로 위젯 불필요
  if (!s.expanded && s.activeMode) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  // 위젯 완전 제거 조건: 패널 접힘 + 모드 비활성 + 스트리밍 없음(또는 compact 숨김)
  if (!s.expanded && (!s.streaming || !s.showCompactWhenCollapsed)) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  ctx.ui.setWidget(WIDGET_KEY, (_tui, _theme) => ({
    render(width: number): string[] {
      const state = getState();

      // alt+p로 패널을 펼친 경우 → 기존 전체 패널 렌더링
      if (state.expanded) {
        const frameColor = state.activeMode
          ? (DIRECT_MODE_COLORS[state.activeMode] ?? PANEL_COLOR)
          : PANEL_COLOR;
        return renderPanelFull(
          width, state.cols, state.frame, frameColor, state.bottomHint, state.activeMode, state.bodyH,
        );
      }
      // 스트리밍 중 compact 상태바
      return renderPanelCompact(width, state.cols, state.frame);
    },
    invalidate() {},
  }));
}

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
  options?: { expand?: boolean; clis?: string[]; showCompactWhenCollapsed?: boolean },
): void {
  const s = getState();
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

// ─── 모델 설정 동기화 ──────────────────────────────────────

/**
 * CLI별 모델/추론 설정을 패널 상태에 반영합니다.
 * footer 세그먼트에 모델명과 effort가 표시됩니다.
 */
export function setAgentPanelModelConfig(
  config: Record<string, { model: string; effort?: string }>,
): void {
  const s = getState();
  s.modelConfig = config;
  syncFooterStatus(s.lastCtx);
}

/**
 * 서비스 상태를 패널 footer 상태에 반영합니다.
 */
export function setAgentPanelServiceStatus(
  snapshots: ServiceSnapshot[],
  lastUpdatedAt: number | null,
): void {
  const s = getState();
  s.serviceSnapshots = snapshots;
  s.serviceLastUpdatedAt = lastUpdatedAt;
  s.serviceLoading = false;
  syncFooterStatus(s.lastCtx);
}

/**
 * 서비스 상태 로딩 중 표시를 footer 상태에 반영합니다.
 */
export function setAgentPanelServiceLoading(): void {
  const s = getState();
  s.serviceLoading = true;
  syncFooterStatus(s.lastCtx);
}

// ─── 패널 높이 조절 ──────────────────────────────────────

/**
 * 패널 본문 높이를 delta만큼 조절합니다.
 * MIN_BODY_H ~ MAX_BODY_H 범위 내로 클램핑됩니다.
 * @returns 조절 후 높이
 */
export function adjustPanelHeight(ctx: ExtensionContext, delta: number): number {
  const s = getState();
  const prev = s.bodyH;
  s.bodyH = Math.max(MIN_BODY_H, Math.min(MAX_BODY_H, s.bodyH + delta));
  // 높이 변경 시 bottomHint에 현재 높이 표시 (피드백용)
  s.bottomHint = ` alt+p toggle · j↑ k↓ [h=${s.bodyH}]`;
  if (prev !== s.bodyH) {
    // setWidget(undefined) 없이 바로 교체 — 중간 상태 렌더링을 방지
    // (undefined 먼저 호출하면 clearOnShrink=false 환경에서 잔상이 남음)
    syncWidget(ctx);
  }
  return s.bodyH;
}

/** 현재 패널 본문 높이를 반환합니다. */
export function getPanelBodyHeight(): number {
  return getState().bodyH;
}

// ─── 단축키 등록 ─────────────────────────────────────────

/**
 * 에이전트 패널 단축키를 등록합니다.
 * - alt+p: 패널 표시/숨김 토글
 * - alt+j: 패널 높이 증가
 * - alt+k: 패널 높이 감소
 *
 * unified-agent-direct/index.ts에서 호출됩니다.
 */
export function registerAgentPanelShortcut(pi: ExtensionAPI): void {
  pi.registerShortcut("alt+p", {
    description: "에이전트 패널 표시/숨김 토글",
    handler: async (ctx) => {
      toggleAgentPanel(ctx);
    },
  });

  pi.registerShortcut("alt+j", {
    description: "에이전트 패널 높이 증가",
    handler: async (ctx) => {
      adjustPanelHeight(ctx, BODY_H_STEP);
    },
  });

  pi.registerShortcut("alt+k", {
    description: "에이전트 패널 높이 감소",
    handler: async (ctx) => {
      adjustPanelHeight(ctx, -BODY_H_STEP);
    },
  });
}
