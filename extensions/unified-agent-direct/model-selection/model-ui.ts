/**
 * unified-agent-direct — 모델 선택 UI 및 커맨드
 *
 * Per-CLI 모델/추론 설정 선택 UI와 관련 단축키/커맨드를 등록합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType, ModelSelection, SelectedModelsConfig } from "../../unified-agent-core/types";
import {
  loadSelectedModels,
  saveSelectedModels,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "../../unified-agent-core/model-config";
import { cleanIdleClients } from "../../unified-agent-core/client-pool";
import { INFRA_KEYBIND_KEY } from "../../infra-keybind/types.js";
import type { InfraKeybindAPI } from "../../infra-keybind/types.js";
import {
  CLI_DISPLAY_NAMES,
  CLI_ORDER,
  DIRECT_MODE_KEYS,
} from "../constants";
import { getActiveModeId, notifyStatusUpdate } from "../modes/framework";
import { setAgentPanelModelConfig } from "../core/panel/config.js";

// ─── 모델 설정 동기화 ────────────────────────────────────

/** 모델 설정을 디스크에서 읽어 패널 footer에 반영합니다. */
export function syncModelConfig(extensionDir: string): void {
  setAgentPanelModelConfig(loadSelectedModels(extensionDir));
}

// ─── 모델 선택 UI ────────────────────────────────────────

/**
 * 단일 CLI의 모델 + 추론 설정을 인터랙티브하게 선택합니다.
 * 취소 시 undefined를 반환합니다.
 */
async function selectModelForCli(
  cli: CliType,
  ctx: ExtensionContext,
  configDir: string,
): Promise<ModelSelection | undefined> {
  const cliName = CLI_DISPLAY_NAMES[cli] ?? cli;
  const previousSelection = loadSelectedModels(configDir);
  const prev = previousSelection[cli];

  let provider;
  try {
    provider = getAvailableModels(cli);
  } catch {
    ctx.ui.notify(`${cliName}: 모델 정보를 가져올 수 없습니다.`, "error");
    return undefined;
  }

  // 모델 선택
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

  // codex 전용: reasoning effort
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

  // claude 전용: thinking (reasoning effort + budget_tokens)
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

// ─── 커맨드 및 단축키 등록 ────────────────────────────────

/**
 * 모델 변경 단축키(alt+shift+m)와 /ua-models 커맨드를 등록합니다.
 */
export function registerModelCommands(
  pi: ExtensionAPI,
  extensionDir: string,
): void {
  const cliTypes = CLI_ORDER;
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;

  // ── Per-CLI 모델 변경 단축키 ──
  keybind.register({
    extension: "unified-agent-direct",
    action: "model-change",
    defaultKey: "alt+shift+m",
    description: "활성 CLI 모델/추론 설정 변경",
    category: "Infra",
    handler: async (ctx) => {
      // 1. 대상 CLI 결정
      const activeModeId = getActiveModeId();
      let targetCli: CliType;

      if (activeModeId && cliTypes.includes(activeModeId as CliType)) {
        // 독점 뷰 (alt+1/2/3) → 해당 CLI 바로 진입
        targetCli = activeModeId as CliType;
      } else {
        // All 모드 / 비활성 → CLI 선택 UI 표시
        const cliOptions = cliTypes.map((cli) =>
          `${CLI_DISPLAY_NAMES[cli] ?? cli} (${DIRECT_MODE_KEYS[cli] ?? cli})`,
        );
        const choice = await ctx.ui.select("모델을 변경할 CLI 선택:", cliOptions);
        if (choice === undefined) return;
        targetCli = cliTypes[cliOptions.indexOf(choice)];
      }

      // 2. Per-CLI 모델 선택
      const selection = await selectModelForCli(targetCli, ctx, extensionDir);
      if (!selection) return;

      // 3. 기존 설정에 merge 저장 (다른 CLI 설정 보존)
      const existing = loadSelectedModels(extensionDir);
      existing[targetCli] = selection;
      saveSelectedModels(extensionDir, existing);
      cleanIdleClients();

      // 4. 알림 + 상태바 갱신
      const cliName = CLI_DISPLAY_NAMES[targetCli] ?? targetCli;
      let summary = `${cliName}=${selection.model}`;
      if (selection.effort) summary += ` effort=${selection.effort}`;
      if (selection.budgetTokens) summary += ` budget=${selection.budgetTokens}`;
      ctx.ui.notify(`모델 설정 저장: ${summary}`, "info");

      syncModelConfig(extensionDir);
      notifyStatusUpdate();
    },
  });

  // ── 모델 선택 커맨드 ──
  pi.registerCommand("ua-models", {
    description: "서브에이전트별 모델 선택 (gemini → claude → codex)",
    handler: async (_args, ctx) => {
      const selectionOrder: CliType[] = ["gemini", "claude", "codex"];
      const selectedModels: SelectedModelsConfig = {};

      for (const cli of selectionOrder) {
        const selection = await selectModelForCli(cli, ctx, extensionDir);
        if (selection === undefined) {
          ctx.ui.notify("모델 선택이 취소되었습니다.", "warning");
          return;
        }
        selectedModels[cli] = selection;
      }

      // 저장
      saveSelectedModels(extensionDir, selectedModels);
      cleanIdleClients();

      // 요약 알림
      const summary = Object.entries(selectedModels).map(([k, v]) => {
        let s = `${k}=${v.model}`;
        if (v.effort) s += ` effort=${v.effort}`;
        if (v.budgetTokens) s += ` budget=${v.budgetTokens}`;
        return s;
      }).join(", ");
      ctx.ui.notify(`모델 선택 저장 완료: ${summary}`, "info");

      // 상태바 갱신 (자체 + 외부 확장)
      syncModelConfig(extensionDir);
      notifyStatusUpdate();
    },
  });
}
