/**
 * operation-name/register.ts — 세션 작전명 자동 생성 확장 진입점
 *
 * 배선(wiring)만 담당: 이벤트 핸들러, 커맨드 등록.
 */

import type { Api, Model } from "../../compat/pi-ai-bridge.js";
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import type { ReasoningLevel } from "@sbluemin/fleet-core/metaphor/operation-name";
import { REASONING_LEVELS, REASONING_LABELS, REASONING_COLORS, isValidReasoning } from "@sbluemin/fleet-core/metaphor/operation-name";
import { loadSettings, saveSettings } from "@sbluemin/fleet-core/metaphor/operation-name";
import type { OperationNameSettings } from "@sbluemin/fleet-core/metaphor/operation-name";
import { generateOperationName, OPERATION_PREFIX, resolveModel } from "../../tui/metaphor/operation-name-summarizer.js";
import { getSettingsAPI } from "../../config-bridge/settings/bridge.js";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";

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
  const worldviewEnabled = isWorldviewEnabled();

  let summaryText: string;
  if (worldviewEnabled && trimmedSummary.startsWith(OPERATION_PREFIX)) {
    const codename = trimmedSummary.slice(OPERATION_PREFIX.length);
    summaryText = `${theme.fg("dim", OPERATION_PREFIX)}${theme.fg("accent", codename)}`;
  } else {
    summaryText = theme.fg(worldviewEnabled ? "muted" : "accent", trimmedSummary);
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
