/**
 * operation-name/register.ts — 세션 작전명 자동 생성 확장 진입점
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드 등록.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import type { ReasoningLevel } from "./constants.js";
import { REASONING_LEVELS, REASONING_LABELS, REASONING_COLORS, isValidReasoning } from "./constants.js";
import { loadSettings, saveSettings } from "./settings.js";
import type { OperationNameSettings } from "./settings.js";
import { generateOperationName, OPERATION_PREFIX, resolveModel } from "./summarizer.js";
import { getSettingsAPI } from "../../core/settings/bridge.js";

const OPERATION_NAME_STATUS_KEY = "metaphor-operation-name-status";
const SESSION_ID_LENGTH = 8;
const SUMMARY_SEPARATOR = "›";

export function registerOperationName(pi: ExtensionAPI): void {
  const initialSettings = loadSettings();
  let currentReasoning: ReasoningLevel =
    initialSettings.reasoning && isValidReasoning(initialSettings.reasoning)
      ? initialSettings.reasoning
      : "off";
  let operationNameAttempted = false;

  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: "metaphor-operation-name",
    displayName: "Operation Naming",
    getDisplayFields() {
      const s = loadSettings();
      const sessionName = pi.getSessionName();
      return [
        { label: "Model", value: s.model || "session model", color: s.model ? "accent" : "dim" },
        { label: "Provider", value: s.provider || "session model", color: s.provider ? "accent" : "dim" },
        { label: "Reasoning", value: REASONING_LABELS[currentReasoning], color: REASONING_COLORS[currentReasoning] },
        { label: "Session", value: sessionName || "작전 명명 대기", color: sessionName ? "accent" : "dim" },
      ];
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    operationNameAttempted = false;

    const operationName = pi.getSessionName()?.trim();
    if (!operationName) {
      ctx.ui.setWidget(OPERATION_NAME_STATUS_KEY, undefined);
      return;
    }

    setSummaryWidget(ctx, getCurrentSessionId(ctx), operationName);
    operationNameAttempted = true;
  });

  pi.on("input", async (event, ctx) => {
    const source = (event as any).source;
    if (source === "extension") return;

    const userText = (event as any).text?.trim();
    if (!userText) return;
    if (userText.startsWith("/")) return;
    if (operationNameAttempted) return;
    if (pi.getSessionName()?.trim()) {
      operationNameAttempted = true;
      return;
    }

    operationNameAttempted = true;

    const settings = loadSettings();
    const model = resolveModel(ctx, settings);
    if (!model) return;

    const requestSessionId = getCurrentSessionId(ctx);

    void generateOperationName(ctx, model, userText, currentReasoning).then((operationName) => {
      if (!operationName) return;
      if (!isSameSession(requestSessionId, getCurrentSessionId(ctx))) return;
      if (pi.getSessionName()?.trim()) return;
      pi.setSessionName(operationName);
      setSummaryWidget(ctx, getCurrentSessionId(ctx), operationName);
    });
  });

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

export default registerOperationName;

function setSummaryWidget(ctx: any, sessionId: string | undefined, summary: string): void {
  ctx.ui.setWidget(OPERATION_NAME_STATUS_KEY, (_tui: any, theme: Theme) => ({
    render: (width: number) => [centerLine(buildSummaryLine(theme, sessionId, summary, width), width)],
    invalidate() {},
  }), { placement: "belowEditor" });
}

function buildSummaryLine(
  theme: Theme,
  sessionId: string | undefined,
  summary: string,
  width: number,
): string {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) return "";

  let summaryText: string;
  if (trimmedSummary.startsWith(OPERATION_PREFIX)) {
    const codename = trimmedSummary.slice(OPERATION_PREFIX.length);
    summaryText = `${theme.fg("dim", OPERATION_PREFIX)}${theme.fg("accent", codename)}`;
  } else {
    summaryText = theme.fg("muted", trimmedSummary);
  }
  const shortSessionId = sessionId?.slice(0, SESSION_ID_LENGTH);
  if (!shortSessionId) {
    return truncateToWidth(summaryText, width);
  }

  const sessionText = theme.fg("dim", shortSessionId);
  const separatorText = theme.fg("dim", ` ${SUMMARY_SEPARATOR} `);
  const combined = `${sessionText}${separatorText}${summaryText}`;

  if (visibleWidth(combined) > width) {
    return truncateToWidth(summaryText, width);
  }

  return combined;
}

function getCurrentSessionId(ctx: any): string | undefined {
  return ctx.sessionManager?.getSessionId?.();
}

function isSameSession(
  requestSessionId: string | undefined,
  currentSessionId: string | undefined,
): boolean {
  return requestSessionId === currentSessionId;
}

function centerLine(line: string, width: number): string {
  const visLen = visibleWidth(line);
  const pad = Math.max(0, Math.floor((width - visLen) / 2));
  return truncateToWidth(" ".repeat(pad) + line, width);
}
