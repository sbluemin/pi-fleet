import type { CoreLogAPI } from "./types.js";
import { CORE_LOG_KEY } from "./types.js";

const NOOP_LOG_API: CoreLogAPI = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  log() {},
  isEnabled: () => false,
  setEnabled() {},
  getRecentLogs: () => [],
  registerCategory() {},
  getRegisteredCategories: () => [],
};

export function getLogAPI(): CoreLogAPI {
  return (globalThis as Record<string, unknown>)[CORE_LOG_KEY] as CoreLogAPI ?? NOOP_LOG_API;
}

export function initLogAPI(api: CoreLogAPI): void {
  (globalThis as Record<string, unknown>)[CORE_LOG_KEY] = api;
}
