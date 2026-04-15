/**
 * core-improve-prompt/engine.ts — LLM 엔진 (ACP 전용)
 *
 * UnifiedAgentClient를 사용한 원샷 메타 프롬프팅.
 * completeSimple(pi-ai) 대신 unified-agent 직접 연동.
 */

import { UnifiedAgentClient } from "@sbluemin/unified-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

import type { ReasoningLevel } from "./constants.js";
import { REASONING_LABELS, SYSTEM_INSTRUCTION } from "./constants.js";
import { PROVIDER_ID, parseModelId } from "../agentclientprotocol/provider-types.js";
import type { MetaPromptSettings } from "./settings.js";

/** Reasoning 레벨 → unified-agent effort 문자열 매핑 */
const REASONING_TO_EFFORT: Record<ReasoningLevel, string | null> = {
  off: null,
  low: "low",
  medium: "medium",
  high: "high",
};

/** 설정 기반 ACP 모델 resolve — ACP 전용, 비-ACP 프로바이더 차단 */
export function resolveModel(ctx: ExtensionContext, settings: MetaPromptSettings): Model<Api> | null {
  // 설정에 모델 지정 시 → modelRegistry에서 검색
  if (settings.model) {
    const model = ctx.modelRegistry.find(PROVIDER_ID, settings.model);
    if (!model) {
      ctx.ui.notify(
        `ACP 모델을 찾을 수 없습니다: ${settings.model} — /fleet:prompt:settings 로 재설정하세요.`,
        "error",
      );
      return null;
    }
    return model;
  }

  // 설정 없음 → 세션 모델 폴백 (ACP 여부 검증)
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("모델이 선택되지 않았습니다. /fleet:prompt:settings 로 설정하세요.", "error");
    return null;
  }

  if (model.provider !== PROVIDER_ID) {
    ctx.ui.notify(
      `메타 프롬프트는 Fleet ACP 모델만 지원합니다. 현재: ${model.provider}/${model.id}`,
      "error",
    );
    return null;
  }

  return model;
}

/** 시스템 지침 + 사용자 프롬프트를 XML 구조로 결합 */
function buildPrompt(userPrompt: string): string {
  return [
    "<system-instruction>",
    SYSTEM_INSTRUCTION,
    "</system-instruction>",
    "",
    userPrompt,
  ].join("\n");
}

/** 메타 프롬프팅 + BorderedLoader 스피너 (UnifiedAgentClient 원샷) */
export async function metaPromptWithLoader(
  ctx: ExtensionContext,
  model: NonNullable<ExtensionContext["model"]>,
  userPrompt: string,
  reasoning: ReasoningLevel,
): Promise<string | null> {
  const parsed = parseModelId(model.id);
  if (!parsed) {
    ctx.ui.notify(`잘못된 ACP 모델 ID: ${model.id}`, "error");
    return null;
  }

  const reasoningLabel = REASONING_LABELS[reasoning];

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(
      tui,
      theme,
      `프롬프트 개선 중... (${model.id} · reasoning: ${reasoningLabel})`,
    );
    loader.onAbort = () => done(null);

    const doMetaPrompt = async () => {
      const client = new UnifiedAgentClient();
      let fullResponse = "";

      try {
        // 응답 청크 수집
        client.on("messageChunk", (text) => {
          fullResponse += text;
        });

        // abort 핸들링 — ESC 누르면 프롬프트 취소 + 연결 해제
        const onAbort = () => {
          client.cancelPrompt().catch(() => {});
          client.disconnect().catch(() => {});
        };
        loader.signal.addEventListener("abort", onAbort, { once: true });

        // ACP CLI 연결
        await client.connect({
          cli: parsed.cli,
          cwd: process.cwd(),
          model: parsed.backendModel,
          autoApprove: true,
          yoloMode: true,
        });

        // reasoning effort 설정 (미지원 CLI는 무시)
        const effort = REASONING_TO_EFFORT[reasoning];
        if (effort) {
          try {
            await client.setConfigOption("reasoning_effort", effort);
          } catch {
            // reasoning_effort 미지원 CLI — 무시
          }
        }

        // 프롬프트 전송 + 응답 대기
        const prompt = buildPrompt(userPrompt);
        await client.sendMessage(prompt);

        // 정리
        loader.signal.removeEventListener("abort", onAbort);
        await client.disconnect();

        if (loader.signal.aborted) return null;

        return fullResponse.trim() || null;
      } catch (err) {
        await client.disconnect().catch(() => {});
        throw err;
      }
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
