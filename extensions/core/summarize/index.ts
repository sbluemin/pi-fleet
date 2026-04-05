/**
 * core-summarize — 세션 한 줄 자동 요약 확장 진입점
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드 등록.
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  이벤트 흐름                                          │
 * │   agent_end (매 턴) → LLM 한 줄 요약 → setSessionName │
 * │   session_compact  → compaction 요약 기반 재요약       │
 * │   /fleet:summary:run       → 수동 재요약               │
 * │   /fleet:summary:settings  → 모델/길이 설정           │
 * └──────────────────────────────────────────────────────┘
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";


import { loadSettings, saveSettings } from "./settings.js";
import type { AutoSummarizeSettings } from "./settings.js";
import { resolveModel, generateOneLiner } from "./summarizer.js";
import { getSettingsAPI } from "../settings/bridge.js";
import { SUMMARY_FOOTER_STATUS_KEY } from "../hud/editor.js";

export default function (pi: ExtensionAPI) {
  // ── 팝업 섹션 등록 ──

  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: "core-summarize",
    displayName: "Auto Summarize",
    getDisplayFields() {
      const s = loadSettings();
      const sessionName = pi.getSessionName();
      return [
        { label: "Model", value: s.model || "session model", color: s.model ? "accent" : "dim" },
        { label: "Provider", value: s.provider || "session model", color: s.provider ? "accent" : "dim" },
        { label: "Max Length", value: String(s.maxLength ?? 80) },
        { label: "Session", value: sessionName || "요약 대기", color: sessionName ? "accent" : "dim" },
      ];
    },
  });

  // ── 이벤트 핸들러 ──

  pi.on("agent_end", async (event, ctx) => {
    const settings = loadSettings();
    const model = resolveModel(ctx, settings);
    if (!model) return;

    const maxLength = settings.maxLength ?? 80;

    const messages = event.messages;
    if (!messages || messages.length === 0) return;

    const conversationText = serializeConversation(convertToLlm(messages));
    if (!conversationText.trim()) return;

    const summary = await generateOneLiner(ctx, model, conversationText, maxLength);
    if (summary) {
      pi.setSessionName(summary);
      ctx.ui.setStatus(SUMMARY_FOOTER_STATUS_KEY, summary);
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    const compactionSummary = event.compactionEntry?.summary;
    if (!compactionSummary) return;

    const settings = loadSettings();
    const model = resolveModel(ctx, settings);
    if (!model) return;

    const maxLength = settings.maxLength ?? 80;

    const summary = await generateOneLiner(ctx, model, compactionSummary, maxLength);
    if (summary) {
      pi.setSessionName(summary);
      ctx.ui.setStatus(SUMMARY_FOOTER_STATUS_KEY, summary);
    }
  });

  // ── 커맨드 등록 ──

  pi.registerCommand("fleet:summary:settings", {
    description: "자동 요약 설정 (모델 선택 + 최대 길이)",
    handler: async (_args, ctx) => {
      const currentSettings = loadSettings();

      // 1단계: 모델 소스 선택
      const sourceOptions = [
        `세션 모델 사용 (ctx.model)${!currentSettings.provider ? " [current]" : ""}`,
        `모델 직접 선택${currentSettings.provider ? " [current]" : ""}`,
      ];
      const sourceChoice = await ctx.ui.select(
        "요약 모델 소스:",
        sourceOptions,
      );
      if (sourceChoice === undefined) {
        ctx.ui.notify("설정이 취소되었습니다.", "warning");
        return;
      }

      const newSettings: AutoSummarizeSettings = {};

      if (sourceChoice.startsWith("모델 직접 선택")) {
        const allModels = ctx.modelRegistry.getAvailable();
        if (allModels.length === 0) {
          ctx.ui.notify(
            "사용 가능한 모델이 없습니다. API 키를 설정하세요.",
            "error",
          );
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

        // 모델 선택
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

      // 2단계: 최대 길이 설정
      const currentMax = currentSettings.maxLength ?? 80;
      const maxInput = await ctx.ui.input(
        "요약 최대 길이 (문자 수):",
        String(currentMax),
      );

      if (maxInput !== undefined && maxInput.trim()) {
        const parsed = parseInt(maxInput.trim(), 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 200) {
          newSettings.maxLength = parsed;
        } else {
          newSettings.maxLength = 80;
          ctx.ui.notify("유효하지 않은 입력. 기본값 80 사용.", "warning");
        }
      } else {
        newSettings.maxLength = currentMax;
      }

      // 저장
      saveSettings(newSettings);

      const modelSummary =
        newSettings.provider && newSettings.model
          ? `${newSettings.provider}/${newSettings.model}`
          : "세션 모델";
      ctx.ui.notify(
        `설정 저장 완료: 모델=${modelSummary}, 최대 길이=${newSettings.maxLength ?? 80}자`,
        "info",
      );
    },
  });
}
