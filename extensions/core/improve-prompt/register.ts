/**
 * core-improve-prompt — 메타 프롬프팅 확장 진입점 (ACP 전용)
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
import { PROVIDER_ID } from "../agentclientprotocol/provider-types.js";
import { getSettingsAPI } from "../settings/bridge.js";
import { getKeybindAPI } from "../keybind/bridge.js";

export default function (pi: ExtensionAPI) {
  // 설정 파일에서 초기 reasoning 레벨 로드 (기본: off)
  const initialSettings = loadSettings();
  let currentReasoning: ReasoningLevel =
    initialSettings.reasoning && isValidReasoning(initialSettings.reasoning)
      ? initialSettings.reasoning
      : "off";

  // ── 팝업 섹션 등록 ──

  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: "core-improve-prompt",
    displayName: "Meta Prompt",
    getDisplayFields() {
      const s = loadSettings();
      return [
        { label: "Model", value: s.model || "session model", color: s.model ? "accent" : "dim" },
        { label: "Reasoning", value: REASONING_LABELS[currentReasoning], color: REASONING_COLORS[currentReasoning] },
      ];
    },
  });

  // ── 커맨드 등록 ──

  pi.registerCommand("fleet:prompt:settings", {
    description: "메타 프롬프트 설정 (ACP 모델 선택 + reasoning 레벨)",
    handler: async (_args, ctx) => {
      const currentSettings = loadSettings();

      // 1단계: 모델 소스 선택
      const sourceOptions = [
        `세션 모델 사용 (ACP 자동 감지)${!currentSettings.model ? " [current]" : ""}`,
        `ACP 모델 직접 선택${currentSettings.model ? " [current]" : ""}`,
      ];
      const sourceChoice = await ctx.ui.select("메타 프롬프트 모델 소스:", sourceOptions);
      if (sourceChoice === undefined) {
        ctx.ui.notify("설정이 취소되었습니다.", "warning");
        return;
      }

      const newSettings: MetaPromptSettings = { reasoning: currentReasoning };

      if (sourceChoice.startsWith("ACP 모델 직접 선택")) {
        // ACP 모델만 필터링
        const allModels = ctx.modelRegistry.getAvailable();
        const acpModels = allModels.filter((m: Model<Api>) => m.provider === PROVIDER_ID);

        if (acpModels.length === 0) {
          ctx.ui.notify("사용 가능한 ACP 모델이 없습니다.", "error");
          return;
        }

        // 모델 선택
        const modelOptions = acpModels.map((m: Model<Api>) => {
          const marker = m.id === currentSettings.model ? " [current]" : "";
          return `${m.id} — ${m.name}${marker}`;
        });

        const modelChoice = await ctx.ui.select("ACP 모델 선택:", modelOptions);
        if (modelChoice === undefined) {
          ctx.ui.notify("설정이 취소되었습니다.", "warning");
          return;
        }

        const selectedModelId = modelChoice.split(" — ")[0]!.trim();
        newSettings.model = selectedModelId;
      }

      // 2단계: Reasoning 레벨 선택
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

      const modelSummary = newSettings.model ?? "세션 모델 (ACP 자동 감지)";
      ctx.ui.notify(
        `설정 저장 완료: 모델=${modelSummary}, reasoning=${REASONING_LABELS[currentReasoning]}`,
        "info",
      );
    },
  });

  // ── 단축키 등록 ──

  const keybind = getKeybindAPI();
  keybind.register({
    extension: "core-improve-prompt",
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

  keybind.register({
    extension: "core-improve-prompt",
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
