export { CORE_LOG_KEY } from "@sbluemin/fleet-core/core-services/log";
import { CORE_LOG_KEY } from "@sbluemin/fleet-core/core-services/log";
import type { CoreLogAPI } from "@sbluemin/fleet-core/core-services/log";

if (!(globalThis as any)[CORE_LOG_KEY]) {
  const noop: CoreLogAPI = {
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
  (globalThis as any)[CORE_LOG_KEY] = noop;
}

export function getLogAPI(): CoreLogAPI {
  return (globalThis as any)[CORE_LOG_KEY];
}

export function _bootstrapLog(impl: CoreLogAPI): void {
  (globalThis as any)[CORE_LOG_KEY] = impl;
}
