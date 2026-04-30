/**
 * operation-name/register.ts — 세션 작전명 자동 생성 확장 진입점
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드 등록.
 */

import type { Api, Model } from "../../bindings/compat/pi-ai-bridge.js";
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import type { ReasoningLevel } from "@sbluemin/fleet-core/metaphor/operation-name";
import { REASONING_LEVELS, REASONING_LABELS, REASONING_COLORS, isValidReasoning } from "@sbluemin/fleet-core/metaphor/operation-name";
import { loadSettings, saveSettings } from "@sbluemin/fleet-core/metaphor/operation-name";
import type { OperationNameSettings } from "@sbluemin/fleet-core/metaphor/operation-name";
import { generateOperationName, OPERATION_PREFIX, resolveModel } from "../../tui/metaphor/operation-name-summarizer.js";
import { getSettingsAPI } from "../../bindings/config/settings/bridge.js";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";

const OPERATION_NAME_STATUS_KEY = "metaphor-operation-name-status";
const SESSION_ID_LENGTH = 8;
const SUMMARY_SEPARATOR = "›";

export function registerOperationNameCommand(pi: ExtensionAPI): void {
  let currentReasoning: ReasoningLevel = resolveCurrentReasoning();

  pi.registerCommand("fleet:metaphor:operation", {
    description: "작전명 자동 생성 설정 (모델 + reasoning 레벨)",
    handler: async (_args, ctx) => {
      const currentSettings = loadSettings();
      const sourceOptions = [
        `세션 모델 사용 (ctx.model)${!currentSettings.provider ? " [current]" : ""}`,
        `모델 직접 선택${currentSettings.provider ? " [current]" : ""}`,
      ];
      const sourceChoice = await ctx.ui.select(
        "작전명 생성 모델 소스:",
        sourceOptions,
      );
      if (sourceChoice === undefined) {
        ctx.ui.notify("설정이 취소되었습니다.", "warning");
        return;
      }

      const newSettings: OperationNameSettings = { reasoning: currentReasoning };

      if (sourceChoice.startsWith("모델 직접 선택")) {
        const allModels = ctx.modelRegistry.getAvailable();
        if (allModels.length === 0) {
          ctx.ui.notify(
            "사용 가능한 모델이 없습니다. API 키를 설정하세요.",
            "error",
          );
          return;
        }

        const providerMap = new Map<string, Model<Api>[]>();
        for (const m of allModels) {
          const group = providerMap.get(m.provider) ?? [];
          group.push(m);
          providerMap.set(m.provider, group);
        }

        const providers = [...providerMap.keys()];
        const providerOptions = providers.map((p) => {
          const count = providerMap.get(p)!.length;
          const marker = p === currentSettings.provider ? " [current]" : "";
          return `${p} (${count} models)${marker}`;
        });

        const providerChoice = await ctx.ui.select(
          "프로바이더 선택:",
          providerOptions,
        );
        if (providerChoice === undefined) {
          ctx.ui.notify("설정이 취소되었습니다.", "warning");
          return;
        }

        const selectedProvider = providerChoice.split(" (")[0]!;
        const models = providerMap.get(selectedProvider)!;
        const modelOptions = models.map((m) => {
          const marker =
            m.provider === currentSettings.provider &&
            m.id === currentSettings.model
              ? " [current]"
              : "";
          return `${m.id} — ${m.name}${marker}`;
        });

        const modelChoice = await ctx.ui.select(
          `${selectedProvider} 모델 선택:`,
          modelOptions,
        );
        if (modelChoice === undefined) {
          ctx.ui.notify("설정이 취소되었습니다.", "warning");
          return;
        }

        const selectedModelId = modelChoice.split(" — ")[0]!.trim();
        newSettings.provider = selectedProvider;
        newSettings.model = selectedModelId;
      }

      const reasoningOptions = REASONING_LEVELS.map((level) => {
        const marker = level === currentReasoning ? " ✓" : "";
        return `${REASONING_LABELS[level]}${marker}`;
      });

      const reasoningChoice = await ctx.ui.select("Reasoning 레벨:", reasoningOptions);
      if (reasoningChoice === undefined) {
        ctx.ui.notify("설정이 취소되었습니다.", "warning");
        return;
      }

      const reasoningIdx = reasoningOptions.indexOf(reasoningChoice);
      currentReasoning = REASONING_LEVELS[reasoningIdx]!;
      newSettings.reasoning = currentReasoning;

      saveSettings(newSettings);

      const modelSummary =
        newSettings.provider && newSettings.model
          ? `${newSettings.provider}/${newSettings.model}`
          : "세션 모델";
      ctx.ui.notify(
        `설정 저장 완료: 모델=${modelSummary}, reasoning=${REASONING_LABELS[currentReasoning]}`,
        "info",
      );
    },
  });
}

export default registerOperationNameCommand;

function resolveCurrentReasoning(): ReasoningLevel {
  const settings = loadSettings();
  return settings.reasoning && isValidReasoning(settings.reasoning)
    ? settings.reasoning
    : "off";
}
