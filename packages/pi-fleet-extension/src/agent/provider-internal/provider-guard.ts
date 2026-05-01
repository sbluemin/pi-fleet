import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getSettingsService } from "@sbluemin/fleet-core/services/settings";
import { getFleetProviderIds } from "./state.js";

export interface ProviderGuardSettings {
  enabled?: boolean;
}

export interface ProviderGuardState {
  enabled: boolean;
}

export interface GuardedModel {
  provider: string;
}

export interface PatchableModelRegistry {
  __providerGuardPatched?: boolean;
  models: GuardedModel[];
  refresh(): void;
  getAvailable(): GuardedModel[];
}

const PROVIDER_GUARD_SECTION_KEY = "core-provider-guard";
const DEFAULT_PROVIDER_GUARD_ENABLED = true;
const GUARDED_ALLOWED_PROVIDERS = new Set([...getFleetProviderIds(), "openai-codex"]);

let guardState: ProviderGuardState | null = null;

export function registerProviderGuard(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    patchModelRegistry(pi, ctx);
  });
}

export function getGuardState(): ProviderGuardState {
  if (!guardState) {
    guardState = createProviderGuardState(loadProviderGuardSettings());
  }
  return guardState;
}

export function saveProviderGuardSettings(settings: ProviderGuardSettings): void {
  const api = getSettingsService();
  if (!api) throw new Error("Fleet-Core Settings API not available");
  api.save(PROVIDER_GUARD_SECTION_KEY, settings);
}

export function filterProviderGuardModels(registry: PatchableModelRegistry): void {
  registry.models = registry.models.filter((model) => GUARDED_ALLOWED_PROVIDERS.has(model.provider));
}

export function enforceProviderGuardAllowedModel(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const current = ctx.model;
  if (!current || GUARDED_ALLOWED_PROVIDERS.has(current.provider)) return;

  const fallback = ctx.modelRegistry
    .getAvailable()
    .find((model) => GUARDED_ALLOWED_PROVIDERS.has(model.provider));

  if (fallback) {
    pi.setModel(fallback as Parameters<ExtensionAPI["setModel"]>[0]);
  }
}

function loadProviderGuardSettings(): ProviderGuardSettings {
  const api = getSettingsService();
  if (!api) return {};
  try {
    return api.load<ProviderGuardSettings>(PROVIDER_GUARD_SECTION_KEY);
  } catch {
    return {};
  }
}

function createProviderGuardState(settings: ProviderGuardSettings = {}): ProviderGuardState {
  return {
    enabled: settings.enabled ?? DEFAULT_PROVIDER_GUARD_ENABLED,
  };
}

function patchModelRegistry(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const registry = ctx.modelRegistry as unknown as PatchableModelRegistry;

  if (!registry.__providerGuardPatched) {
    registry.__providerGuardPatched = true;

    const originalRefresh = registry.refresh.bind(registry);
    registry.refresh = () => {
      originalRefresh();
      if (getGuardState().enabled) {
        filterProviderGuardModels(registry);
        enforceProviderGuardAllowedModel(pi, ctx);
      }
    };
  }

  if (getGuardState().enabled) {
    filterProviderGuardModels(registry);
    enforceProviderGuardAllowedModel(pi, ctx);
  }
}
