/**
 * fleet/shipyard/carrier/model-ui.ts — 모델 선택 UI 및 커맨드
 *
 * 캐리어별(carrierId) 모델/추론 설정 선택 UI와 관련 단축키/커맨드를 등록합니다.
 * shipyard/store.ts와 직접 협력합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
  CLI_DISPLAY_NAMES,
} from "@sbluemin/fleet-core/constants";
import type { ModelSelection, SelectedModelsConfig } from "@sbluemin/fleet-core/admiral/store";
import {
  loadModels as getModelConfig,
  updateAllModelSelections,
} from "@sbluemin/fleet-core/admiral/store";
import {
  CLI_BACKENDS,
  getProviderModels,
  getReasoningEffortLevels,
  type CliType,
} from "@sbluemin/unified-agent";

import { setAgentPanelModelConfig } from "../ui/panel/config.js";
import {
  notifyStatusUpdate,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  resolveCarrierDisplayName,
} from "../../tool-registry.js";

/** 모델 설정을 런타임에서 읽어 패널 footer에 반영합니다. */
export function syncModelConfig(): void {
  setAgentPanelModelConfig(getModelConfig());
}

export function registerModelCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:agent:models", {
    description: "등록된 캐리어의 모델 선택 (slot 순)",
    handler: async (_args, ctx) => {
      const registeredIds = getRegisteredOrder();
      const selectedModels: SelectedModelsConfig = {};

      for (const carrierId of registeredIds) {
        const cliType = resolveCarrierCliType(carrierId);
        if (!cliType) {
          ctx.ui.notify(`등록되지 않은 carrier입니다: ${carrierId}`, "error");
          return;
        }
        const displayName = resolveCarrierDisplayName(carrierId);
        const selection = await selectModelForCli(cliType, ctx, displayName, carrierId);
        if (selection === undefined) {
          ctx.ui.notify("모델 선택이 취소되었습니다.", "warning");
          return;
        }
        selectedModels[carrierId] = selection;
      }

      await updateAllModelSelections(selectedModels);

      const summary = Object.entries(selectedModels).map(([k, v]) => {
        const displayName = resolveCarrierDisplayName(k);
        let s = `${displayName}=${v.model}`;
        if (v.effort) s += ` effort=${v.effort}`;
        if (v.budgetTokens) s += ` budget=${v.budgetTokens}`;
        return s;
      }).join(", ");
      ctx.ui.notify(`모델 선택 저장 완료: ${summary}`, "info");

      syncModelConfig();
      notifyStatusUpdate();
    },
  });
}

function isCliType(value: string): value is CliType {
  return value in CLI_BACKENDS;
}

function resolveCarrierCliType(carrierId: string): CliType | undefined {
  const cliType = getRegisteredCarrierConfig(carrierId)?.cliType;
  if (cliType) return cliType;
  return isCliType(carrierId) ? carrierId : undefined;
}

async function selectModelForCli(
  cli: CliType,
  ctx: ExtensionContext,
  displayName?: string,
  configKey?: string,
): Promise<ModelSelection | undefined> {
  const cliName = displayName ?? CLI_DISPLAY_NAMES[cli] ?? cli;
  const previousSelection = getModelConfig();
  const prev = previousSelection[configKey ?? cli];

  let provider;
  try {
    provider = getProviderModels(cli);
  } catch {
    ctx.ui.notify(`${cliName}: 모델 정보를 가져올 수 없습니다.`, "error");
    return undefined;
  }

  const options = provider.models.map((m) => {
    const markers: string[] = [];
    if (m.modelId === provider.defaultModel) markers.push("default");
    if (m.modelId === prev?.model) markers.push("current");
    const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
    return `${m.modelId} — ${m.name}${suffix}`;
  });

  const choice = await ctx.ui.select(`${cliName} 모델 선택:`, options);
  if (choice === undefined) return undefined;

  const modelId = choice.split(" — ")[0]!.trim();
  const selection: ModelSelection = { model: modelId };

  if (cli === "codex") {
    const effortLevels = getReasoningEffortLevels(cli);
    if (effortLevels && effortLevels.length > 0) {
      const defaultEffort = provider.reasoningEffort.supported
        ? (provider.reasoningEffort as { default: string }).default
        : undefined;

      const effortOptions = effortLevels.map((level) => {
        const markers: string[] = [];
        if (level === defaultEffort) markers.push("default");
        if (level === prev?.effort) markers.push("current");
        const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
        return `${level}${suffix}`;
      });

      const effortChoice = await ctx.ui.select("Codex reasoning effort:", effortOptions);
      if (effortChoice === undefined) return undefined;
      selection.effort = effortChoice.split(" [")[0]!.trim();
    }
  }

  if (cli === "claude") {
    const effortLevels = getReasoningEffortLevels(cli);
    if (effortLevels && effortLevels.length > 0) {
      const defaultEffort = provider.reasoningEffort.supported
        ? (provider.reasoningEffort as { default: string }).default
        : undefined;

      const effortOptions = effortLevels.map((level) => {
        const markers: string[] = [];
        if (level === defaultEffort) markers.push("default");
        if (level === prev?.effort) markers.push("current");
        const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
        return `${level}${suffix}`;
      });

      const effortChoice = await ctx.ui.select("Claude thinking level:", effortOptions);
      if (effortChoice === undefined) return undefined;
      selection.effort = effortChoice.split(" [")[0]!.trim();
    }
  }

  return selection;
}
