/**
 * fleet/internal/agent/model-ui.ts — 모델 선택 UI 및 커맨드
 *
 * 캐리어별(carrierId) 모델/추론 설정 선택 UI와 관련 단축키/커맨드를 등록합니다.
 * 동일 agent/ 디렉토리의 model-config, runtime과 직접 협력합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { CliType } from "@sbluemin/unified-agent";
import type { ModelSelection, SelectedModelsConfig } from "./model-config.js";
import {
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "./model-config.js";
import {
  getModelConfig,
  updateModelSelection,
  updateAllModelSelections,
} from "./runtime.js";
import { setAgentPanelModelConfig } from "../panel/config.js";
import {
  getActiveCarrierId,
  notifyStatusUpdate,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  resolveCarrierDisplayName,
} from "../../shipyard/carrier/framework.js";
import { INFRA_KEYBIND_KEY } from "../../../dock/keybind/types.js";
import type { InfraKeybindAPI } from "../../../dock/keybind/types.js";
import {
  CLI_DISPLAY_NAMES,
} from "../../constants";

/** 모델 설정을 런타임에서 읽어 패널 footer에 반영합니다. */
export function syncModelConfig(): void {
  setAgentPanelModelConfig(getModelConfig());
}

export function registerModelCommands(pi: ExtensionAPI): void {
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;

  keybind.register({
    extension: "fleet",
    action: "model-change",
    defaultKey: "alt+shift+m",
    description: "활성 캐리어 모델/추론 설정 변경",
    category: "Infra",
    handler: async (ctx) => {
      const activeCarrierId = getActiveCarrierId();
      let targetCarrierId: string;
      let targetCli: CliType;
      let targetDisplayName: string;

      if (activeCarrierId) {
        targetCarrierId = activeCarrierId;
        const resolvedCli = resolveCarrierCliType(activeCarrierId);
        if (!resolvedCli) {
          ctx.ui.notify(`등록되지 않은 carrier입니다: ${activeCarrierId}`, "error");
          return;
        }
        targetCli = resolvedCli;
        targetDisplayName = resolveCarrierDisplayName(activeCarrierId);
      } else {
        const registeredIds = getRegisteredOrder();
        const cliOptions = registeredIds.map((id) => {
          const cfg = getRegisteredCarrierConfig(id);
          const name = resolveCarrierDisplayName(id);
          return `${name} (#${cfg?.slot ?? "?"})`;

        });
        const choice = await ctx.ui.select("모델을 변경할 캐리어 선택:", cliOptions);
        if (choice === undefined) return;
        const chosenId = registeredIds[cliOptions.indexOf(choice)]!;
        targetCarrierId = chosenId;
        const resolvedCli = resolveCarrierCliType(chosenId);
        if (!resolvedCli) {
          ctx.ui.notify(`등록되지 않은 carrier입니다: ${chosenId}`, "error");
          return;
        }
        targetCli = resolvedCli;
        targetDisplayName = resolveCarrierDisplayName(chosenId);
      }

      const selection = await selectModelForCli(targetCli, ctx, targetDisplayName, targetCarrierId);
      if (!selection) return;

      await updateModelSelection(targetCarrierId, selection);

      let summary = `${targetDisplayName}=${selection.model}`;
      if (selection.effort) summary += ` effort=${selection.effort}`;
      if (selection.budgetTokens) summary += ` budget=${selection.budgetTokens}`;
      ctx.ui.notify(`모델 설정 저장: ${summary}`, "info");

      syncModelConfig();
      notifyStatusUpdate();
    },
  });

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
  return value === "claude" || value === "codex" || value === "gemini";
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
    provider = getAvailableModels(cli);
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
    const effortLevels = getEffortLevels(cli);
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
    const effortLevels = getEffortLevels(cli);
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

      if (selection.effort !== "none") {
        const defaultBudget = getDefaultBudgetTokens(selection.effort);
        const currentBudget = prev?.budgetTokens;
        const placeholder = currentBudget
          ? `${currentBudget} (current)`
          : `${defaultBudget} (default for ${selection.effort})`;

        const budgetInput = await ctx.ui.input(
          `Claude budget_tokens (${selection.effort}):`,
          placeholder,
        );

        if (budgetInput !== undefined && budgetInput.trim()) {
          const parsed = parseInt(budgetInput.trim(), 10);
          if (!isNaN(parsed) && parsed > 0) {
            selection.budgetTokens = parsed;
          } else {
            selection.budgetTokens = defaultBudget;
            ctx.ui.notify(`유효하지 않은 입력. 기본값 ${defaultBudget} 사용.`, "warning");
          }
        } else {
          selection.budgetTokens = currentBudget ?? defaultBudget;
        }
      }
    }
  }

  return selection;
}
