import type { PanelJob } from "./types.js";

export interface AgentPanelJobState {
  panelJobs: Map<string, PanelJob>;
}

export const STATE_KEY = "__pi_agent_panel_state__";
export const PANEL_JOB_RETENTION = 8;

export function getState(): AgentPanelJobState {
  let state = (globalThis as any)[STATE_KEY] as Partial<AgentPanelJobState> | undefined;
  if (!state) {
    state = {};
    (globalThis as any)[STATE_KEY] = state;
  }
  if (!(state.panelJobs instanceof Map)) {
    state.panelJobs = new Map();
  }
  return state as AgentPanelJobState;
}

export function getPanelJobs(): Map<string, PanelJob> {
  return getState().panelJobs;
}
