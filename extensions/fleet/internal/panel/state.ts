/**
 * panel/state.ts — 에이전트 패널 globalThis 상태 싱글턴 + 칼럼 헬퍼
 *
 * 패널 모듈 내부에서만 사용합니다.
 * getState()를 통해 공유 상태에 접근합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CLI_ORDER, DEFAULT_BODY_H } from "../../constants";
import { getSessionStore } from "../agent/runtime.js";
import { ensureVisibleRun, setRunSessionId } from "../streaming/stream-store";
import type { AgentCol, ServiceSnapshot } from "../contracts.js";

export type { AgentCol } from "../contracts.js";

export const STATE_KEY = "__pi_agent_panel_state__";
export const WIDGET_KEY = "ua-panel";
export const DEFAULT_CLIS = CLI_ORDER as readonly string[];

export interface FooterModelInfo {
  model: string;
  effort?: string;
}

export interface AgentPanelState {
  cols: AgentCol[];
  expanded: boolean;
  streaming: boolean;
  showCompactWhenCollapsed: boolean;
  frame: number;
  animTimer: ReturnType<typeof setInterval> | null;
  lastCtx: ExtensionContext | null;
  activeMode: string | null;
  bottomHint: string;
  modelConfig: Record<string, FooterModelInfo>;
  serviceSnapshots: ServiceSnapshot[];
  serviceLastUpdatedAt: number | null;
  serviceLoading: boolean;
  toggleCallbacks: Array<(expanded: boolean) => void>;
  bodyH: number;
}

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
      toggleCallbacks: [],
      bodyH: DEFAULT_BODY_H,
    };
    (globalThis as any)[STATE_KEY] = s;
  }
  if (s.activeMode === undefined) s.activeMode = null;
  if (s.bottomHint === undefined) s.bottomHint = " alt+p toggle · j↑ k↓";
  if (!s.modelConfig) s.modelConfig = {};
  if (!s.serviceSnapshots) s.serviceSnapshots = [];
  if (s.serviceLastUpdatedAt === undefined) s.serviceLastUpdatedAt = null;
  if (s.serviceLoading === undefined) s.serviceLoading = false;
  if (!s.toggleCallbacks) s.toggleCallbacks = [];
  if (s.bodyH === undefined) s.bodyH = DEFAULT_BODY_H;
  return s;
}

export function makeCols(clis?: readonly string[]): AgentCol[] {
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;
  const targets = clis ?? DEFAULT_CLIS;

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
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;

  for (const col of s.cols) {
    col.sessionId = sessionMap[col.cli];
    setRunSessionId(col.cli, sessionMap[col.cli]);
  }
}

export function makeFooterCols(): AgentCol[] {
  const s = getState();
  const activeCols = new Map(s.cols.map((col) => [col.cli, col] as const));
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;

  return DEFAULT_CLIS.map((cli) => {
    const activeCol = activeCols.get(cli);
    if (activeCol) return activeCol;

    const run = ensureVisibleRun(cli);
    return {
      cli,
      sessionId: sessionMap[cli] ?? run.sessionId,
      text: "",
      blocks: [],
      thinking: "",
      toolCalls: [],
      status: "wait" as const,
      error: undefined,
      scroll: 0,
    };
  });
}
