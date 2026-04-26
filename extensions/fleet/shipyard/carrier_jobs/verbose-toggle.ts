interface CarrierJobsVerboseState {
  value: boolean;
  callbacks: Array<(value: boolean) => void>;
}

const CARRIER_JOBS_VERBOSE_KEY = "__pi_fleet_carrier_jobs_verbose__";

export function getCarrierJobsVerbose(): boolean {
  return getState().value;
}

export function setCarrierJobsVerbose(value: boolean): void {
  const state = getState();
  if (state.value === value) return;
  state.value = value;
  notifyCarrierJobsVerboseChange(state);
}

export function toggleCarrierJobsVerbose(): boolean {
  const next = !getCarrierJobsVerbose();
  setCarrierJobsVerbose(next);
  return next;
}

export function onCarrierJobsVerboseChange(callback: (value: boolean) => void): () => void {
  const state = getState();
  state.callbacks.push(callback);
  return () => {
    const index = state.callbacks.indexOf(callback);
    if (index >= 0) state.callbacks.splice(index, 1);
  };
}

export function resetCarrierJobsVerboseForTest(): void {
  const state = getState();
  state.value = false;
  state.callbacks = [];
}

function notifyCarrierJobsVerboseChange(state: CarrierJobsVerboseState): void {
  for (const callback of state.callbacks) {
    try { callback(state.value); } catch { /* ignore listener failures */ }
  }
}

function getState(): CarrierJobsVerboseState {
  const root = globalThis as Record<string, unknown>;
  const existing = root[CARRIER_JOBS_VERBOSE_KEY] as CarrierJobsVerboseState | undefined;
  if (existing) return existing;
  const state: CarrierJobsVerboseState = { value: false, callbacks: [] };
  root[CARRIER_JOBS_VERBOSE_KEY] = state;
  return state;
}
