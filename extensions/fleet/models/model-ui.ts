/**
 * fleet — 모델 선택 UI 및 커맨드
 *
 * Per-CLI 모델/추론 설정 선택 UI와 관련 단축키/커맨드를 등록합니다.
 * 모델 변경 결과 적용(영속화 + 세션 무효화)은 core에 위임합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { CliType } from "@sbluemin/unified-agent";
import type { ModelSelection, SelectedModelsConfig } from "../core/index.js";
import {
  getModelConfig,
  updateModelSelection,
  updateAllModelSelections,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
  setAgentPanelModelConfig,
} from "../core/index.js";
import { INFRA_KEYBIND_KEY } from "../../infra/keybind/types.js";
import type { InfraKeybindAPI } from "../../infra/keybind/types.js";
import {
  CLI_DISPLAY_NAMES,
  CLI_ORDER,
  DIRECT_MODE_KEYS,
} from "../constants";

/** 모델 설정을 런타임에서 읽어 패널 footer에 반영합니다. */
export function syncModelConfig(): void {
  setAgentPanelModelConfig(getModelConfig());
}

async function selectModelForCli(
  cli: CliType,
  ctx: ExtensionContext,
): Promise<ModelSelection | undefined> {
  const cliName = CLI_DISPLAY_NAMES[cli] ?? cli;
  const previousSelection = getModelConfig();
  const prev = previousSelection[cli];

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

export function registerModelCommands(
  pi: ExtensionAPI,
  deps: {
    getActiveModeId: () => string | null;
    notifyStatusUpdate: () => void;
  },
): void {
  const cliTypes = CLI_ORDER;
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;

  keybind.register({
    extension: "fleet",
    action: "model-change",
    defaultKey: "alt+shift+m",
    description: "활성 CLI 모델/추론 설정 변경",
    category: "Infra",
    handler: async (ctx) => {
      const activeModeId = deps.getActiveModeId();
      let targetCli: CliType;

      if (activeModeId && cliTypes.includes(activeModeId as CliType)) {
        targetCli = activeModeId as CliType;
      } else {
        const cliOptions = cliTypes.map((cli) =>
          `${CLI_DISPLAY_NAMES[cli] ?? cli} (${DIRECT_MODE_KEYS[cli] ?? cli})`,
        );
        const choice = await ctx.ui.select("모델을 변경할 CLI 선택:", cliOptions);
        if (choice === undefined) return;
        targetCli = cliTypes[cliOptions.indexOf(choice)];
      }

      const selection = await selectModelForCli(targetCli, ctx);
      if (!selection) return;

      await updateModelSelection(targetCli, selection);

      const cliName = CLI_DISPLAY_NAMES[targetCli] ?? targetCli;
      let summary = `${cliName}=${selection.model}`;
      if (selection.effort) summary += ` effort=${selection.effort}`;
      if (selection.budgetTokens) summary += ` budget=${selection.budgetTokens}`;
      ctx.ui.notify(`모델 설정 저장: ${summary}`, "info");

      syncModelConfig();
      deps.notifyStatusUpdate();
    },
  });

  pi.registerCommand("fleet:agent:models", {
    description: "서브에이전트별 모델 선택 (gemini → claude → codex)",
    handler: async (_args, ctx) => {
      const selectionOrder: CliType[] = ["gemini", "claude", "codex"];
      const selectedModels: SelectedModelsConfig = {};

      for (const cli of selectionOrder) {
        const selection = await selectModelForCli(cli, ctx);
        if (selection === undefined) {
          ctx.ui.notify("모델 선택이 취소되었습니다.", "warning");
          return;
        }
        selectedModels[cli] = selection;
      }

      await updateAllModelSelections(selectedModels);

      const summary = Object.entries(selectedModels).map(([k, v]) => {
        let s = `${k}=${v.model}`;
        if (v.effort) s += ` effort=${v.effort}`;
        if (v.budgetTokens) s += ` budget=${v.budgetTokens}`;
        return s;
      }).join(", ");
      ctx.ui.notify(`모델 선택 저장 완료: ${summary}`, "info");

      syncModelConfig();
      deps.notifyStatusUpdate();
    },
  });
}
