/**
 * utils-improve-prompt — 메타 프롬프팅 확장 진입점
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드, 단축키 등록.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { ReasoningLevel } from "./constants.js";
import { REASONING_LEVELS, REASONING_LABELS, REASONING_COLORS, isValidReasoning } from "./constants.js";
import { loadSettings, saveSettings } from "./settings.js";
import type { MetaPromptSettings } from "./settings.js";
import { resolveModel, metaPromptWithLoader } from "./engine.js";
import type { InfraSettingsAPI } from "../infra-settings/types.js";
import { INFRA_SETTINGS_KEY } from "../infra-settings/types.js";
import { INFRA_KEYBIND_KEY } from "../infra-keybind/types.js";
import type { InfraKeybindAPI } from "../infra-keybind/types.js";

export default function (pi: ExtensionAPI) {
  // 설정 파일에서 초기 reasoning 레벨 로드 (기본: off)
  const initialSettings = loadSettings();
  let currentReasoning: ReasoningLevel =
    initialSettings.reasoning && isValidReasoning(initialSettings.reasoning)
      ? initialSettings.reasoning
      : "off";

  // ── 팝업 섹션 등록 ──

  const infraApi = (globalThis as any)[INFRA_SETTINGS_KEY] as InfraSettingsAPI | undefined;
  infraApi?.registerSection({
    key: "utils-improve-prompt",
    displayName: "Meta Prompt",
    getDisplayFields() {
      const s = loadSettings();
      return [
        { label: "Model", value: s.model || "session model", color: s.model ? "accent" : "dim" },
        { label: "Provider", value: s.provider || "session model", color: s.provider ? "accent" : "dim" },
        { label: "Reasoning", value: REASONING_LABELS[currentReasoning], color: REASONING_COLORS[currentReasoning] },
      ];
    },
  });

  // ── 커맨드 등록 ──

  pi.registerCommand("mp-settings", {
    description: "메타 프롬프트 설정 (모델 선택 + reasoning 레벨)",
    handler: async (_args, ctx) => {
      const currentSettings = loadSettings();

      // 1단계: 모델 소스 선택
      const sourceOptions = [
        `세션 모델 사용 (ctx.model)${!currentSettings.provider ? " [current]" : ""}`,
        `모델 직접 선택${currentSettings.provider ? " [current]" : ""}`,
      ];
      const sourceChoice = await ctx.ui.select("메타 프롬프트 모델 소스:", sourceOptions);
      if (sourceChoice === undefined) {
        ctx.ui.notify("설정이 취소되었습니다.", "warning");
        return;
      }

      const newSettings: MetaPromptSettings = { reasoning: currentReasoning };

      if (sourceChoice.startsWith("모델 직접 선택")) {
        const allModels = ctx.modelRegistry.getAvailable();
        if (allModels.length === 0) {
          ctx.ui.notify("사용 가능한 모델이 없습니다. API 키를 설정하세요.", "error");
          return;
        }

        // 프로바이더별 그룹핑
        const providerMap = new Map<string, Model<Api>[]>();
        for (const m of allModels) {
          const group = providerMap.get(m.provider) ?? [];
          group.push(m);
          providerMap.set(m.provider, group);
        }

        // 프로바이더 선택
        const providers = [...providerMap.keys()];
        const providerOptions = providers.map((p) => {
          const count = providerMap.get(p)!.length;
          const marker = p === currentSettings.provider ? " [current]" : "";
          return `${p} (${count} models)${marker}`;
        });

        const providerChoice = await ctx.ui.select("프로바이더 선택:", providerOptions);
        if (providerChoice === undefined) {
          ctx.ui.notify("설정이 취소되었습니다.", "warning");
          return;
        }

        const selectedProvider = providerChoice.split(" (")[0]!;
        const models = providerMap.get(selectedProvider)!;

        // 모델 선택
        const modelOptions = models.map((m) => {
          const markers: string[] = [];
          if (m.provider === currentSettings.provider && m.id === currentSettings.model) {
            markers.push("current");
          }
          const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
          return `${m.id} — ${m.name}${suffix}`;
        });

        const modelChoice = await ctx.ui.select(`${selectedProvider} 모델 선택:`, modelOptions);
        if (modelChoice === undefined) {
          ctx.ui.notify("설정이 취소되었습니다.", "warning");
          return;
        }

        const selectedModelId = modelChoice.split(" — ")[0]!.trim();
        const selectedModel = models.find((m) => m.id === selectedModelId);
        if (!selectedModel) {
          ctx.ui.notify(`모델을 찾을 수 없습니다: ${selectedModelId}`, "error");
          return;
        }
        newSettings.provider = selectedModel.provider;
        newSettings.model = selectedModel.id;
      }

      // 3단계: Reasoning 레벨 선택
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

      // 저장
      saveSettings(newSettings);

      const modelSummary = newSettings.provider && newSettings.model
        ? `${newSettings.provider}/${newSettings.model}`
        : "세션 모델";
      ctx.ui.notify(
        `설정 저장 완료: 모델=${modelSummary}, reasoning=${REASONING_LABELS[currentReasoning]}`,
        "info",
      );
    },
  });

  pi.registerCommand("meta-prompt", {
    description: "메타 프롬프팅 기법으로 프롬프트를 개선하여 입력창에 삽입",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        ctx.ui.notify("사용법: /meta-prompt <개선할 요청사항>", "warning");
        return;
      }

      const settings = loadSettings();
      const model = resolveModel(ctx, settings);
      if (!model) return;

      const result = await metaPromptWithLoader(ctx, model, trimmed, currentReasoning);
      if (result === null) return;

      ctx.ui.setEditorText(result);
    },
  });

  // ── 단축키 등록 ──

  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "utils-improve-prompt",
    action: "meta-prompt",
    defaultKey: "alt+m",
    description: "메타 프롬프팅으로 현재 입력을 개선 (스피너 + ESC 취소)",
    category: "Meta Prompt",
    handler: async (ctx) => {
      const editorText = ctx.ui.getEditorText();
      const trimmed = editorText?.trim();

      if (!trimmed) {
        ctx.ui.notify("입력창에 프롬프트를 먼저 작성하세요.", "warning");
        return;
      }

      const settings = loadSettings();
      const model = resolveModel(ctx, settings);
      if (!model) return;

      const result = await metaPromptWithLoader(ctx, model, trimmed, currentReasoning);
      if (result === null) return;

      ctx.ui.setEditorText(result);
    },
  });

  pi.registerCommand("mp-reasoning", {
    description: "메타 프롬프트 reasoning 레벨 변경 (off/low/medium/high)",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg && isValidReasoning(arg)) {
        currentReasoning = arg;
        const settings = loadSettings();
        settings.reasoning = currentReasoning;
        saveSettings(settings);
        ctx.ui.notify(
          `Meta-prompt reasoning → ${REASONING_LABELS[currentReasoning]}`,
          "info",
        );
        return;
      }

      const options = REASONING_LEVELS.map((level) => {
        const marker = level === currentReasoning ? " ✓" : "";
        return `${REASONING_LABELS[level]}${marker}`;
      });

      const choice = await ctx.ui.select("Meta-prompt Reasoning Level", options);
      if (choice === undefined) return;

      const choiceIdx = options.indexOf(choice);
      currentReasoning = REASONING_LEVELS[choiceIdx]!;
      const settings = loadSettings();
      settings.reasoning = currentReasoning;
      saveSettings(settings);
      ctx.ui.notify(
        `Meta-prompt reasoning → ${REASONING_LABELS[currentReasoning]}`,
        "info",
      );
    },
  });

  keybind.register({
    extension: "utils-improve-prompt",
    action: "reasoning-cycle",
    defaultKey: "alt+r",
    description: "메타 프롬프트 reasoning 레벨 사이클 (off→low→medium→high)",
    category: "Meta Prompt",
    handler: async (ctx) => {
      const idx = REASONING_LEVELS.indexOf(currentReasoning);
      currentReasoning = REASONING_LEVELS[(idx + 1) % REASONING_LEVELS.length]!;
      const settings = loadSettings();
      settings.reasoning = currentReasoning;
      saveSettings(settings);
      ctx.ui.notify(
        `Meta-prompt reasoning → ${REASONING_LABELS[currentReasoning]}`,
        "info",
      );
    },
  });
}
