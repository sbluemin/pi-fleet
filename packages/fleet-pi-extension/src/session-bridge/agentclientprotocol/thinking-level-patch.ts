import { AgentSession, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model } from "../../compat/pi-ai-bridge.js";
import {
  clampThinkingLevel,
  getAcpAvailableThinkingLevels,
  type UiThinkingLevel,
} from "@sbluemin/fleet-core/agent/thinking-level-patch";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

type PatchableModel = Pick<Model<any>, "id" | "provider" | "reasoning">;

type PatchableAgentSession = InstanceType<typeof AgentSession> & {
  getAvailableThinkingLevels(): UiThinkingLevel[];
  supportsXhighThinking(): boolean;
  model?: PatchableModel;
};

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const THINKING_LEVEL_PATCH_KEY = Symbol.for("__pi_fleet_acp_thinking_level_patch__");

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

export { clampThinkingLevel, getAcpAvailableThinkingLevels, type UiThinkingLevel };
