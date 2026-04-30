/**
 * panel/state.ts — 에이전트 패널 globalThis 상태 싱글턴 + 칼럼 헬퍼
 *
 * 패널 모듈 내부에서만 사용합니다.
 * getState()를 통해 공유 상태에 접근합니다.
 */

import { DEFAULT_BODY_H, formatPanelMultiColHint } from "@sbluemin/fleet-core/constants";
import { getSessionStore } from "@sbluemin/fleet-core/agent/dispatcher/runtime";
import { ensureVisibleRun, setRunSessionId } from "@sbluemin/fleet-core/admiral/bridge/run-stream";
import { getRegisteredOrder, isSquadronCarrierEnabled } from "../../../tool-registry.js";
import type { AgentCol, PanelJob } from "./types.js";
import type { ServiceSnapshot } from "@sbluemin/fleet-core/agent/shared/types";

export type { AgentCol } from "./types.js";

export interface FooterModelInfo {
  model: string;
  effort?: string;
}

export interface AgentPanelState {
  cols: AgentCol[];
  panelJobs: Map<string, PanelJob>;
  expanded: boolean;
  streaming: boolean;
  frame: number;
  animTimer: ReturnType<typeof setInterval> | null;
  /** 패널 로컬 상세 뷰 대상 ColumnTrack ID (null = N칼럼 뷰) */
  detailTrackId: string | null;
  bottomHint: string;
  /** 캐리어별(carrierId) 모델 설정 */
  modelConfig: Record<string, FooterModelInfo>;
  serviceSnapshots: ServiceSnapshot[];
  serviceLastUpdatedAt: number | null;
  serviceLoading: boolean;
  toggleCallbacks: Array<(expanded: boolean) => void>;
  bodyH: number;
  /** 인라인 슬롯 내비게이션 커서 위치 (-1 = 비활성) */
  cursorColumn: number;
}

export const STATE_KEY = "__pi_agent_panel_state__";
export const WIDGET_KEY = "ua-panel";
export const PANEL_JOB_RETENTION = 8;

/**
 * 동적으로 등록된 carrier 순서를 반환합니다.
 * index.ts가 registerCarriers()를 먼저 호출한 뒤 panel/runtime 초기화를 진행하므로
 * 기본 경로에서는 여기서 빈 registeredOrder를 보지 않습니다.
 */
export function getDefaultClis(): readonly string[] {
  return getRegisteredOrder().filter(id => !isSquadronCarrierEnabled(id));
}

export function getState(): AgentPanelState {
  let s = (globalThis as any)[STATE_KEY] as AgentPanelState | undefined;
  if (!s) {
    s = {
      cols: makeCols(),
      panelJobs: new Map(),
      expanded: false,
      streaming: false,
      frame: 0,
      animTimer: null,
      detailTrackId: null,
      bottomHint: formatPanelMultiColHint(),
      modelConfig: {},
      serviceSnapshots: [],
      serviceLastUpdatedAt: null,
      serviceLoading: false,
      toggleCallbacks: [],
      bodyH: DEFAULT_BODY_H,
      cursorColumn: -1,
    };
    (globalThis as any)[STATE_KEY] = s;
  }
  const legacyDetailCarrierId = (s as AgentPanelState & { detailCarrierId?: string | null }).detailCarrierId;
  if (s.detailTrackId === undefined) s.detailTrackId = legacyDetailCarrierId ?? null;
  if ("detailCarrierId" in s) delete (s as AgentPanelState & { detailCarrierId?: string | null }).detailCarrierId;
  if (!(s.panelJobs instanceof Map)) s.panelJobs = new Map();
  if ("activeJobId" in s) delete (s as AgentPanelState & { activeJobId?: string | null }).activeJobId;
  if (s.bottomHint === undefined) s.bottomHint = formatPanelMultiColHint();
  if (!s.modelConfig) s.modelConfig = {};
  if (!s.serviceSnapshots) s.serviceSnapshots = [];
  if (s.serviceLastUpdatedAt === undefined) s.serviceLastUpdatedAt = null;
  if (s.serviceLoading === undefined) s.serviceLoading = false;
  if (!s.toggleCallbacks) s.toggleCallbacks = [];
  if (s.bodyH === undefined) s.bodyH = DEFAULT_BODY_H;
  if (s.cursorColumn === undefined) s.cursorColumn = -1;
  if ("lastCtx" in s) delete (s as AgentPanelState & { lastCtx?: unknown }).lastCtx;

  // cols가 비어있는데 캐리어가 이미 등록된 경우 lazy 재생성
  // 초기화 타이밍 경합(state 생성 시점 < 캐리어 등록 시점)으로 발생하는 빈 패널을 복구한다
  if (s.cols.length === 0 && getDefaultClis().length > 0) {
    s.cols = makeCols();
  }

  return s;
}

export function makeCols(clis?: readonly string[]): AgentCol[] {
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;
  const targets = clis ?? getDefaultClis();

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

export function getPanelJobs(): Map<string, PanelJob> {
  return getState().panelJobs;
}

export function getRegisteredCarrierCols(): AgentCol[] {
  return getState().cols;
}

/** carrierId에 해당하는 cols 배열 내 인덱스를 반환합니다. 없으면 -1. */
export function findColIndex(carrierId: string): number {
  return getState().cols.findIndex((col) => col.cli === carrierId);
}

export function syncColsWithRegisteredOrder(): void {
  const s = getState();
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;
  const existing = new Map(s.cols.map((col) => [col.cli, col] as const));
  const orderedIds = getDefaultClis();
  const selectedCarrierId = s.cursorColumn >= 0 && s.cursorColumn < s.cols.length
    ? s.cols[s.cursorColumn]?.cli ?? null
    : null;

  s.cols = orderedIds.map((cli) => {
    const col = existing.get(cli);
    const sessionId = sessionMap[cli];
    setRunSessionId(cli, sessionId);
    if (col) {
      col.sessionId = sessionId;
      return col;
    }

    const run = ensureVisibleRun(cli);
    return {
      cli,
      sessionId: sessionId ?? run.sessionId,
      text: "",
      blocks: [],
      thinking: "",
      toolCalls: [],
      status: "wait" as const,
      error: undefined,
      scroll: 0,
    };
  });

  if (selectedCarrierId) {
    s.cursorColumn = s.cols.findIndex((col) => col.cli === selectedCarrierId);
  }
  if (s.cursorColumn >= s.cols.length) {
    s.cursorColumn = s.cols.length > 0 ? s.cols.length - 1 : -1;
  }
}

/**
 * 현재 포커싱된 carrier ID를 반환합니다.
 * 상세 뷰 대상 → 멀티칼럼 커서 포커싱 순으로 우선순위를 적용합니다.
 * 아무 것도 선택되지 않으면 null.
 */
export function getFocusedCarrierId(): string | null {
  const s = getState();
  if (s.expanded && s.cursorColumn >= 0 && s.cursorColumn < s.cols.length) {
    return s.cols[s.cursorColumn]?.cli ?? null;
  }
  return null;
}

export function makeFooterCols(): AgentCol[] {
  const s = getState();
  const activeCols = new Map(s.cols.map((col) => [col.cli, col] as const));
  const sessionMap = getSessionStore().getAll() as Readonly<Record<string, string | undefined>>;

  return getRegisteredOrder().map((cli) => {
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
