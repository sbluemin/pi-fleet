import { readBridgeState, writeBridgeState } from "../run-stream/state-store.js";
import type { PanelJob } from "./types.js";

export interface AgentPanelJobState {
  panelJobs: Map<string, PanelJob>;
}

export const STATE_KEY = "__pi_agent_panel_state__";
export const PANEL_JOB_RETENTION = 8;

export function getState(): AgentPanelJobState {
  let state = readBridgeState<Partial<AgentPanelJobState>>(STATE_KEY);
  if (!state) {
    state = {};
    writeBridgeState(STATE_KEY, state);
  }
  if (!(state.panelJobs instanceof Map)) {
    state.panelJobs = new Map();
  }
  return state as AgentPanelJobState;
}

export function getPanelJobs(): Map<string, PanelJob> {
  return getState().panelJobs;
}
