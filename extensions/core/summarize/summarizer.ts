/**
 * core-summarize/summarizer.ts — 핵심 비즈니스 로직
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
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return null;

    if (!auth.apiKey && !auth.headers && ctx.modelRegistry.isUsingOAuth(model)) {
      return null;
    }

    // 마지막 200줄만 전달 — Phase는 최근 대화에 언급되므로 후미 집중이 유리
    const lines = conversationText.split("\n");
    const truncated =
      lines.length > 200
        ? "[...이전 내용 생략...]\n\n" + lines.slice(-200).join("\n")
        : conversationText;

    const response = await completeSimple(
      model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Summarize this conversation in one line (max ${maxLength + 40} chars):\n\n${truncated}`,
            timestamp: Date.now(),
          },
        ],
      },
      {
        ...(auth.apiKey && { apiKey: auth.apiKey }),
        ...(auth.headers && { headers: auth.headers }),
        maxTokens: 200,
      },
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
