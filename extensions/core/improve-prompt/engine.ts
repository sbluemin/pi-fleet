/**
 * core-improve-prompt/engine.ts — LLM 엔진
 *
 * 메타 프롬프팅 LLM 호출 + BorderedLoader UI 로직.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { Api, Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

import type { ReasoningLevel } from "./constants.js";
import { REASONING_LABELS, SYSTEM_INSTRUCTION } from "./constants.js";
import type { MetaPromptSettings } from "./settings.js";

/** 설정 파일 기반 모델 resolve */
export function resolveModel(ctx: ExtensionContext, settings: MetaPromptSettings): Model<Api> | null {
  const { provider, model: modelId } = settings;
  if (!provider && modelId?.startsWith("acp:")) {
    ctx.ui.notify(
      "기존 ACP 전용 메타 프롬프트 설정은 롤백 후 사용할 수 없습니다. /fleet:prompt:settings 로 재설정하세요.",
      "error",
    );
    return null;
  }

  const resolved =
    provider && modelId
      ? ctx.modelRegistry.find(provider, modelId)
      : ctx.model;

  if (!resolved) {
    const hint =
      provider && modelId
        ? `모델을 찾을 수 없습니다: ${provider}/${modelId} — /fleet:prompt:settings 로 재설정하세요.`
        : "모델이 선택되지 않았습니다. /fleet:prompt:settings 로 설정하세요.";
    ctx.ui.notify(hint, "error");
  }

  return resolved ?? null;
}

/** 메타 프롬프팅 + BorderedLoader 스피너 */
export async function metaPromptWithLoader(
  ctx: ExtensionContext,
  model: NonNullable<ExtensionContext["model"]>,
  userPrompt: string,
  reasoning: ReasoningLevel,
): Promise<string | null> {
  const reasoningLabel = REASONING_LABELS[reasoning];

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(
      tui,
      theme,
      `프롬프트 개선 중... (${model.id} · reasoning: ${reasoningLabel})`,
    );
    loader.onAbort = () => done(null);

    const doMetaPrompt = async () => {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        throw new Error(auth.error);
      }

      if (!auth.apiKey && !auth.headers && ctx.modelRegistry.isUsingOAuth(model)) {
        throw new Error(
          `OAuth 인증 정보를 사용할 수 없습니다: ${model.provider}/${model.id} — /login ${model.provider} 로 다시 인증하세요.`,
        );
      }

      const response = await completeSimple(
        model,
        {
          systemPrompt: SYSTEM_INSTRUCTION,
          messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
        },
        {
          ...(auth.apiKey && { apiKey: auth.apiKey }),
          ...(auth.headers && { headers: auth.headers }),
          signal: loader.signal,
          ...(reasoning !== "off" && { reasoning: reasoning as ThinkingLevel }),
        },
      );

      if (response.stopReason === "aborted") return null;

      const improved = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return improved.trim() || null;
    };

    doMetaPrompt()
      .then(done)
      .catch((e) => {
        ctx.ui.notify(
          `프롬프트 개선 실패: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
        done(null);
      });

    return loader;
  });
}
