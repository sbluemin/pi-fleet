/**
 * panel/state.ts — 에이전트 패널 globalThis 상태 싱글턴 + 칼럼 헬퍼
 *
 * 패널 모듈 내부에서만 사용합니다.
 * getState()를 통해 공유 상태에 접근합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SessionMapStore } from "../../../unified-agent-core/session-map";
import { CLI_ORDER, DEFAULT_BODY_H } from "../../constants";
import { ensureVisibleRun, setRunSessionId } from "../streaming/stream-store";
import type { AgentCol, ServiceSnapshot, ServiceStatusRendererFn } from "../contracts.js";

// 편의를 위한 re-export
export type { AgentCol } from "../contracts.js";

// ─── 상수 ────────────────────────────────────────────────

export const STATE_KEY = "__pi_agent_panel_state__";
export const WIDGET_KEY = "ua-panel";
export const DEFAULT_CLIS = CLI_ORDER as readonly string[];

// ─── 타입 ────────────────────────────────────────────────

/** CLI별 모델/추론 설정 (footer 표시용) */
export interface FooterModelInfo {
  model: string;
  effort?: string;
}

export interface AgentPanelState {
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
  /** 서비스 상태 토큰 렌더러 (feature에서 주입 — core→feature 역방향 의존 방지) */
  serviceStatusRenderer: ServiceStatusRendererFn | null;
  /** 패널 토글 리스너 */
  toggleCallbacks: Array<(expanded: boolean) => void>;
  /** 세션 매핑 저장소 (호출처가 주입) */
  sessionStore: SessionMapStore | null;
  /** 패널 본문 높이 (줄 수) — 런타임 조절 가능 */
  bodyH: number;
}

// ─── 상태 접근 ───────────────────────────────────────────

export function getState(): AgentPanelState {
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
      serviceStatusRenderer: null,
      toggleCallbacks: [],
      sessionStore: null,
      bodyH: DEFAULT_BODY_H,
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
  if (s.serviceStatusRenderer === undefined) s.serviceStatusRenderer = null;
  if (!s.toggleCallbacks) s.toggleCallbacks = [];
  if (s.sessionStore === undefined) s.sessionStore = null;
  if (s.bodyH === undefined) s.bodyH = DEFAULT_BODY_H;
  return s;
}

// ─── 칼럼 헬퍼 ───────────────────────────────────────────

export function makeCols(clis?: readonly string[]): AgentCol[] {
  // getState()를 호출하면 상호 재귀가 발생하므로 globalThis에서 직접 읽음
  const existing = (globalThis as any)[STATE_KEY] as AgentPanelState | undefined;
  const store = existing?.sessionStore ?? null;
  const sessionMap = (store ? store.getAll() : {}) as Readonly<Record<string, string | undefined>>;
  const targets = clis ?? DEFAULT_CLIS;

  // store에 각 CLI의 visible run이 존재하는지 보장
  for (const cli of targets) {
    ensureVisibleRun(cli);
  }

  return targets.map((cli) => ({
    cli,
    sessionId: sessionMap[cli],
    text: "",
    blocks: [],
    thinking: "",
    toolCalls: [],
    status: "wait" as const,
    scroll: 0,
  }));
}

export function syncColSessionIds(): void {
  const s = getState();
  const store = s.sessionStore;
  const sessionMap = (store ? store.getAll() : {}) as Readonly<Record<string, string | undefined>>;

  for (const col of s.cols) {
    col.sessionId = sessionMap[col.cli];
    // store의 run에도 sessionId 동기화
    setRunSessionId(col.cli, sessionMap[col.cli]);
  }
}
