import { AgentSession, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getProviderModels } from "@sbluemin/unified-agent";
import type { Model } from "../provider.js";

import { parseModelId, PROVIDER_ID } from "./state.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

type PatchableModel = Pick<Model<any>, "id" | "provider" | "reasoning">;
export type UiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type PatchableAgentSession = InstanceType<typeof AgentSession> & {
  getAvailableThinkingLevels(): UiThinkingLevel[];
  supportsXhighThinking(): boolean;
  model?: PatchableModel;
};

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const THINKING_LEVEL_PATCH_KEY = Symbol.for("__pi_fleet_acp_thinking_level_patch__");
const THINKING_LEVEL_ORDER: UiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const ACP_UI_LEVELS = new Set<UiThinkingLevel>(["low", "medium", "high", "xhigh"]);

export function installAcpThinkingLevelPatch(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[THINKING_LEVEL_PATCH_KEY]) {
    return;
  }

  const prototype = AgentSession.prototype as PatchableAgentSession;
  const originalGetAvailableThinkingLevels = prototype.getAvailableThinkingLevels;
  const originalSupportsXhighThinking = prototype.supportsXhighThinking;

  prototype.getAvailableThinkingLevels = function getAvailableThinkingLevelsPatched(this: PatchableAgentSession): UiThinkingLevel[] {
    const override = getAcpAvailableThinkingLevels(this.model);
    return override ?? originalGetAvailableThinkingLevels.call(this);
  };

  prototype.supportsXhighThinking = function supportsXhighThinkingPatched(this: PatchableAgentSession): boolean {
    const override = getAcpAvailableThinkingLevels(this.model);
    if (override) {
      return override.includes("xhigh");
    }
    return originalSupportsXhighThinking.call(this);
  };

  g[THINKING_LEVEL_PATCH_KEY] = true;
}

export function reconcileAcpThinkingLevel(
  pi: Pick<ExtensionAPI, "getThinkingLevel" | "setThinkingLevel">,
  model: PatchableModel | undefined,
): void {
  const availableLevels = getAcpAvailableThinkingLevels(model);
  if (!availableLevels) {
    return;
  }

  const currentLevel = pi.getThinkingLevel() as UiThinkingLevel;
  const nextLevel = availableLevels.includes(currentLevel)
    ? currentLevel
    : clampThinkingLevel(currentLevel, availableLevels);

  if (nextLevel !== currentLevel) {
    pi.setThinkingLevel(nextLevel);
  }
}

export function getAcpAvailableThinkingLevels(
  model: PatchableModel | undefined,
): UiThinkingLevel[] | null {
  if (!model || model.provider !== PROVIDER_ID || !model.reasoning) {
    return null;
  }

  const parsed = parseModelId(model.id);
  if (!parsed) {
    return null;
  }

  const provider = getProviderModels(parsed.cli);
  if (!provider?.reasoningEffort.supported) {
    return ["off"];
  }

  const levels = provider.reasoningEffort.levels.filter(
    (level): level is UiThinkingLevel => ACP_UI_LEVELS.has(level as UiThinkingLevel),
  );

  return ["off", ...levels];
}

export function clampThinkingLevel(
  level: UiThinkingLevel,
  availableLevels: UiThinkingLevel[],
): UiThinkingLevel {
  const available = new Set(availableLevels);
  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level);

  if (requestedIndex === -1) {
    return availableLevels[0] ?? "off";
  }

  for (let i = requestedIndex; i < THINKING_LEVEL_ORDER.length; i++) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (available.has(candidate)) {
      return candidate;
    }
  }

  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (available.has(candidate)) {
      return candidate;
    }
  }

  return availableLevels[0] ?? "off";
}
