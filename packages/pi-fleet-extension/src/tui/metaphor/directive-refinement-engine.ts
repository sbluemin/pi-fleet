/**
 * directive-refinement/engine.ts — LLM 엔진
 *
 * 작전 지령 재다듬기 LLM 호출 + BorderedLoader UI 로직.
 */

import { completeSimple } from "../../bindings/compat/pi-ai-bridge.js";
import { composeDirectiveRefinementRequest } from "@sbluemin/fleet-core/metaphor";
import type { Api, Model, ThinkingLevel } from "../../bindings/compat/pi-ai-bridge.js";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

import type { ReasoningLevel } from "@sbluemin/fleet-core/metaphor/directive-refinement";
import { REASONING_LABELS } from "@sbluemin/fleet-core/metaphor/directive-refinement";
import type { DirectiveRefinementSettings } from "@sbluemin/fleet-core/metaphor/directive-refinement";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";

/** 설정 파일 기반 모델 resolve */
export function resolveModel(
  ctx: ExtensionContext,
  settings: DirectiveRefinementSettings,
): Model<Api> | null {
  const { provider, model: modelId } = settings;
  if (!provider && modelId?.startsWith("acp:")) {
    ctx.ui.notify(
      "기존 ACP 전용 지령 재다듬기 설정은 그대로 복원할 수 없습니다. /fleet:metaphor:directive 로 재설정하세요.",
      "error",
    );
    return null;
  }

  const resolved = provider && modelId ? ctx.modelRegistry.find(provider, modelId) : ctx.model;

  if (!resolved) {
    const hint =
      provider && modelId
        ? `모델을 찾을 수 없습니다: ${provider}/${modelId} — /fleet:metaphor:directive 로 재설정하세요.`
        : "모델이 선택되지 않았습니다. /fleet:metaphor:directive 로 설정하세요.";
    ctx.ui.notify(hint, "error");
  }

  return resolved ?? null;
}

/** 지령 재다듬기 + BorderedLoader 스피너 */
export async function refineDirectiveWithLoader(
  ctx: ExtensionContext,
  model: NonNullable<ExtensionContext["model"]>,
  userDirective: string,
  reasoning: ReasoningLevel,
): Promise<string | null> {
  const reasoningLabel = REASONING_LABELS[reasoning];
  const worldviewEnabled = isWorldviewEnabled();

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(
      tui,
      theme,
      `${
        worldviewEnabled
          ? "지령 재다듬기 가동 중..."
          : "프롬프트 다듬는 중..."
      } (${model.id} · reasoning: ${reasoningLabel})`,
    );
    loader.onAbort = () => done(null);

    const doRefinement = async () => {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        throw new Error(auth.error);
      }

      if (!auth.apiKey && !auth.headers && ctx.modelRegistry.isUsingOAuth(model)) {
        throw new Error(
          `OAuth 인증 정보를 사용할 수 없습니다: ${model.provider}/${model.id} — /login ${model.provider} 로 다시 인증하세요.`,
        );
      }

      const composed = composeDirectiveRefinementRequest({ worldviewEnabled, userDirective });
      const response = await completeSimple(
        model,
        {
          systemPrompt: composed.systemPrompt,
          messages: composed.messages.map((message) => ({ ...message, timestamp: Date.now() })),
        },
        {
          ...(auth.apiKey && { apiKey: auth.apiKey }),
          ...(auth.headers && { headers: auth.headers }),
          signal: loader.signal,
          ...(reasoning !== "off" && { reasoning: reasoning as ThinkingLevel }),
        },
      );

      if (response.stopReason === "aborted") return null;

      const refinedDirective = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return refinedDirective.trim() || null;
    };

    doRefinement()
      .then(done)
      .catch((e) => {
        ctx.ui.notify(
          `${
            worldviewEnabled
              ? "지령 재다듬기 실패"
              : "프롬프트 다듬기 실패"
          }: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
        done(null);
      });

    return loader;
  });
}
