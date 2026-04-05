/**
 * core-summarize — 세션 한 줄 자동 요약 확장 진입점
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드 등록.
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  이벤트 흐름                                          │
 * │   input (매 턴) → 사용자 프롬프트 → 비차단 작업 제목 생성 │
 * │   /fleet:summary:settings  → 모델 설정                │
 * └──────────────────────────────────────────────────────┘
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";


import { loadSettings, saveSettings } from "./settings.js";
import type { AutoSummarizeSettings } from "./settings.js";
import { resolveModel, generateTaskTitle } from "./summarizer.js";
import { getSettingsAPI } from "../settings/bridge.js";

const SUMMARIZE_STATUS_KEY = "core-summarize-status";

export default function (pi: ExtensionAPI) {
  let pendingInitialSummary = false;

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
        { label: "Session", value: sessionName || "요약 대기", color: sessionName ? "accent" : "dim" },
      ];
    },
  });

  // ── 이벤트 핸들러 ──

  pi.on("input", async (event, ctx) => {
    const source = (event as any).source;
    if (source === "extension") return;

    const userText = (event as any).text?.trim();
    if (!userText) return;

    // 슬래시 명령은 요약 대상 제외
    if (userText.startsWith("/")) return;

    if (pendingInitialSummary) return;
    if (pi.getSessionName()?.trim()) return;

    const settings = loadSettings();
    const model = resolveModel(ctx, settings);
    if (!model) return;

    pendingInitialSummary = true;

    void generateTaskTitle(ctx, model, userText)
      .then((summary) => {
        if (!summary) return;
        if (pi.getSessionName()?.trim()) return;
        pi.setSessionName(summary);
        setSummaryWidget(ctx, summary);
      })
      .finally(() => {
        if (!pi.getSessionName()?.trim()) {
          pendingInitialSummary = false;
        }
      });
  });

  // ── 커맨드 등록 ──

  pi.registerCommand("fleet:summary:settings", {
    description: "자동 요약 설정 (모델 선택)",
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

      // 저장
      saveSettings(newSettings);

      const modelSummary =
        newSettings.provider && newSettings.model
          ? `${newSettings.provider}/${newSettings.model}`
          : "세션 모델";
      ctx.ui.notify(
        `설정 저장 완료: 모델=${modelSummary}`,
        "info",
      );
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 내부 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/** 요약 위젯을 belowEditor에 등록합니다. */
function setSummaryWidget(ctx: any, summary: string): void {
  ctx.ui.setWidget(SUMMARIZE_STATUS_KEY, (_tui: any, _theme: any) => ({
    render: (_w: number) => [summary],
    invalidate() {},
  }), { placement: "belowEditor" });
}
