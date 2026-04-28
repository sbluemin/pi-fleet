import {
  createProviderGuardState,
  GUARD_GLOBAL_KEY,
  type ProviderGuardState,
} from "@sbluemin/fleet-core/core-services/provider-guard";

import { loadSettings } from "./settings.js";

export { GUARD_GLOBAL_KEY, type ProviderGuardState };

if (!(globalThis as any)[GUARD_GLOBAL_KEY]) {
  (globalThis as any)[GUARD_GLOBAL_KEY] = createProviderGuardState(loadSettings());
}

export function getGuardState(): ProviderGuardState {
  return (globalThis as any)[GUARD_GLOBAL_KEY] as ProviderGuardState;
}
