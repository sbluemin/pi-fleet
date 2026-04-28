export interface ProviderGuardSettings {
  enabled?: boolean;
}

export interface ProviderGuardState {
  enabled: boolean;
}

export const GUARD_GLOBAL_KEY = "__pi_provider_guard__";
export const PROVIDER_GUARD_SECTION_KEY = "core-provider-guard";
export const DEFAULT_PROVIDER_GUARD_ENABLED = true;

export function createProviderGuardState(
  settings: ProviderGuardSettings = {},
): ProviderGuardState {
  return {
    enabled: settings.enabled ?? DEFAULT_PROVIDER_GUARD_ENABLED,
  };
}
