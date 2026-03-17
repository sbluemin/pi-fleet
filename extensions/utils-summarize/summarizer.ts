/**
 * utils-summarize/summarizer.ts — 핵심 비즈니스 로직
 *
 * LLM을 호출하여 대화를 한 줄로 요약하는 기능.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { SYSTEM_PROMPT } from "./constants.js";
import type { AutoSummarizeSettings } from "./settings.js";

/** 설정 파일 기반 모델 resolve */
export function resolveModel(
  ctx: ExtensionContext,
  settings: AutoSummarizeSettings,
): Model<Api> | null {
  const { provider, model: modelId } = settings;
  const resolved =
    provider && modelId
      ? ctx.modelRegistry.find(provider, modelId)
      : ctx.model;

  return resolved ?? null;
}

/** LLM 한 줄 요약 생성 */
export async function generateOneLiner(
  ctx: ExtensionContext,
  model: Model<Api>,
  conversationText: string,
  maxLength: number,
): Promise<string | null> {
  try {
    const apiKey = await ctx.modelRegistry.getApiKey(model);
    if (!apiKey) return null;

    // 입력 텍스트가 너무 길면 잘라서 토큰 절약
    const truncated =
      conversationText.length > 12000
        ? conversationText.slice(0, 6000) +
          "\n\n[...중간 생략...]\n\n" +
          conversationText.slice(-6000)
        : conversationText;

    const response = await completeSimple(
      model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Summarize this conversation in one line (max ${maxLength} chars):\n\n${truncated}`,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey, maxTokens: 200 },
    );

    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim()
      .replace(/^["'"""'']+|["'"""'']+$/g, ""); // 따옴표 제거

    if (!text) return null;

    // 첫 줄만 취함 (혹시 여러 줄이 나올 경우)
    const firstLine = text.split("\n")[0]!.trim();
    return firstLine.length > maxLength
      ? firstLine.slice(0, maxLength - 1) + "…"
      : firstLine;
  } catch {
    return null;
  }
}
