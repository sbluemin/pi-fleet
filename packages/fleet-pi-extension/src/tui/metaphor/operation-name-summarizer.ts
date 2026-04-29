/**
 * operation-name/summarizer.ts — 작전명 생성 비즈니스 로직
 */

import { completeSimple } from "../../bindings/compat/pi-ai-bridge.js";
import { composeOperationNameRequest } from "@sbluemin/fleet-core/metaphor";
import type { Api, Model, ThinkingLevel } from "../../bindings/compat/pi-ai-bridge.js";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { ReasoningLevel, OperationNameSettings } from "@sbluemin/fleet-core/metaphor/operation-name";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";

const MAX_LENGTH = 40;
const MAX_INPUT_LENGTH = 200;
const OPERATION_LABEL = "Operation";
const OPERATION_SEPARATOR = "›";
export const OPERATION_PREFIX = `${OPERATION_LABEL} ${OPERATION_SEPARATOR} `;
const BIDI_CONTROL_REGEX = /[\u202A-\u202E\u2066-\u2069]/g;
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
const OSC_REGEX = /\x1b\][^\u0007\x1b]*(?:\u0007|\x1b\\)/g;
const CONTROL_REGEX = /[\u0000-\u001F\u007F-\u009F]/g;
const SECRET_PATTERNS = [
  /sk_(?:live|test)_[A-Za-z0-9]+/g,
  /sk-proj-[A-Za-z0-9_-]+/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /ya29\.[0-9A-Za-z\-_]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/g,
  /[a-z]+:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi,
  /(?:api[_-]?key|token|secret|password)\s*=\s*[^\s]+/gi,
  /OPENAI_API_KEY\s*=\s*[^\s]+/gi,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /[A-Za-z0-9+/]{32,}={0,2}/g,
  /[a-f0-9]{32,}/gi,
];

/** 설정 파일 기반 모델 resolve */
export function resolveModel(
  ctx: ExtensionContext,
  settings: OperationNameSettings,
): Model<Api> | null {
  const { provider, model: modelId } = settings;
  const resolved =
    provider && modelId
      ? ctx.modelRegistry.find(provider, modelId)
      : ctx.model;

  return resolved ?? null;
}

/** LLM 작전명 생성 */
export async function generateOperationName(
  ctx: ExtensionContext,
  model: Model<Api>,
  userPrompt: string,
  reasoning: ReasoningLevel,
): Promise<string | null> {
  try {
    const worldviewEnabled = isWorldviewEnabled();
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return null;

    if (!auth.apiKey && !auth.headers && ctx.modelRegistry.isUsingOAuth(model)) {
      return null;
    }

    const preparedPrompt = preparePromptForSummary(userPrompt);
    if (!preparedPrompt) return null;

    const composed = composeOperationNameRequest({
      worldviewEnabled,
      preparedPrompt: worldviewEnabled
        ? `Generate an operation codename for this request (max ${MAX_LENGTH} chars total, including the "${OPERATION_PREFIX}" prefix):\n\n${preparedPrompt}`
        : `Generate a short English task summary for this request (max ${MAX_LENGTH} chars total):\n\n${preparedPrompt}`,
    });

    const response = await completeSimple(
      model,
      {
        systemPrompt: composed.systemPrompt,
        messages: composed.messages.map((message) => ({ ...message, timestamp: Date.now() })),
      },
      {
        ...(auth.apiKey && { apiKey: auth.apiKey }),
        ...(auth.headers && { headers: auth.headers }),
        maxTokens: 60,
        ...(reasoning !== "off" && { reasoning: reasoning as ThinkingLevel }),
      },
    );

    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim()
      .replace(/^["'"""'']+|["'"""'']+$/g, "");

    if (!text) return null;

    const firstLine = sanitizeSummary(text.split("\n")[0]!.trim());
    if (!firstLine) return null;

    const strippedSummary = stripOperationPrefix(firstLine);
    const finalSummary = worldviewEnabled
      ? ensureOperationPrefix(firstLine)
      : (strippedSummary || null);
    if (!finalSummary) return null;

    return finalSummary.length > MAX_LENGTH
      ? finalSummary.slice(0, MAX_LENGTH - 1) + "…"
      : finalSummary;
  } catch {
    return null;
  }
}

function preparePromptForSummary(userPrompt: string): string {
  const singleLine = userPrompt
    .replace(/```[\s\S]*?```/g, "[코드]")
    .replace(/`[^`]*`/g, "[코드]")
    .replace(/\s+/g, " ")
    .trim();

  if (!singleLine) return "";

  let sanitized = singleLine;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  return sanitized.length > MAX_INPUT_LENGTH
    ? sanitized.slice(0, MAX_INPUT_LENGTH) + "…"
    : sanitized;
}

function sanitizeSummary(summary: string): string {
  return summary
    .replace(OSC_REGEX, "")
    .replace(ANSI_REGEX, "")
    .replace(BIDI_CONTROL_REGEX, "")
    .replace(CONTROL_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureOperationPrefix(summary: string): string | null {
  const codename = stripOperationPrefix(summary);
  if (!codename) return null;
  return `${OPERATION_PREFIX}${codename}`;
}

function stripOperationPrefix(summary: string): string {
  return summary.replace(/^operation\s*[›»▸‣·—\-:|]?\s*/i, "").trim();
}
