import { getProviderModelsRegistry } from "./client.js";
import { parseModelId, PROVIDER_ID } from "./types.js";

export type UiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AcpThinkingModel {
  id: string;
  provider: string;
  reasoning?: unknown;
}

const THINKING_LEVEL_ORDER: UiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const ACP_UI_LEVELS = new Set<UiThinkingLevel>(["low", "medium", "high", "xhigh"]);

export function getAcpAvailableThinkingLevels(
  model: AcpThinkingModel | undefined,
): UiThinkingLevel[] | null {
  if (!model || model.provider !== PROVIDER_ID || !model.reasoning) {
    return null;
  }

  const parsed = parseModelId(model.id);
  if (!parsed) {
    return null;
  }

  const provider = getProviderModelsRegistry().providers[parsed.cli];
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
