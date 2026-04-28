/**
 * core-hud/context.ts — 세그먼트 컨텍스트 빌더
 *
 * 세션 이벤트를 파싱하여 세그먼트 렌더링에 필요한 컨텍스트를 구성한다.
 */

import type { AssistantMessage } from "../../compat/pi-ai-bridge.js";
import type { Theme } from "@mariozechner/pi-coding-agent";

import type { ColorScheme, HudCoreConfig, SegmentContext, SegmentStateProvider } from "./types.js";
import { getPreset } from "./presets.js";
import { getGitStatus } from "./git-status.js";
import { getDefaultColors } from "./theme.js";

/**
 * 세션 이벤트에서 사용량 통계와 컨텍스트를 추출하여 SegmentContext를 구성.
 *
 * @param ctx       - pi ExtensionContext (세션, 모델 정보)
 * @param theme     - 현재 pi 테마
 * @param provider  - footerDataRef, getThinkingLevelFn, sessionStartTime 을 제공하는 객체
 * @param config    - core-hud 프리셋 설정
 */
export function buildSegmentContext(
  ctx: any,
  theme: Theme,
  provider: SegmentStateProvider,
  config: HudCoreConfig,
): SegmentContext {
  const presetDef = getPreset(config.preset);
  const colors: ColorScheme = presetDef.colors ?? getDefaultColors();

  // 사용량 통계 + thinking 레벨을 세션에서 추출
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
  let lastAssistant: AssistantMessage | undefined;
  let thinkingLevelFromSession = "off";

  const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
  for (const e of sessionEvents) {
    if (e.type === "thinking_level_change" && e.thinkingLevel) {
      thinkingLevelFromSession = e.thinkingLevel;
    }
    if (e.type === "message" && e.message.role === "assistant") {
      const m = e.message as AssistantMessage;
      if (m.stopReason === "error" || m.stopReason === "aborted") {
        continue;
      }
      input += m.usage.input;
      output += m.usage.output;
      cacheRead += m.usage.cacheRead;
      cacheWrite += m.usage.cacheWrite;
      cost += m.usage.cost.total;
      lastAssistant = m;
    }
  }

  // 컨텍스트 사용률 계산 (마지막 턴의 총 토큰 / 컨텍스트 윈도우)
  const contextTokens = lastAssistant
    ? lastAssistant.usage.input + lastAssistant.usage.output +
      lastAssistant.usage.cacheRead + lastAssistant.usage.cacheWrite
    : 0;
  const contextWindow = ctx.model?.contextWindow || 0;
  const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

  // Git 상태 (캐시됨)
  const gitBranch = provider.footerDataRef?.getGitBranch() ?? null;
  const gitStatus = getGitStatus(gitBranch);

  // OAuth 구독 여부
  const usingSubscription = ctx.model
    ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
    : false;

  return {
    model: ctx.model,
    thinkingLevel: thinkingLevelFromSession || provider.getThinkingLevelFn?.() || "off",
    sessionId: ctx.sessionManager?.getSessionId?.(),
    usageStats: { input, output, cacheRead, cacheWrite, cost },
    contextPercent,
    contextWindow,
    autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
    usingSubscription,
    sessionStartTime: provider.sessionStartTime,
    git: gitStatus,
    extensionStatuses: provider.footerDataRef?.getExtensionStatuses() ?? new Map(),
    options: presetDef.segmentOptions ?? {},
    theme,
    colors,
  };
}
