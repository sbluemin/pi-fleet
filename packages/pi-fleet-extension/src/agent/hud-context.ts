/**
 * core-hud/context.ts — 세그먼트 컨텍스트 빌더
 *
 * 세션 이벤트를 파싱하여 세그먼트 렌더링에 필요한 컨텍스트를 구성한다.
 */

import type { AssistantMessage } from "./provider.js";
import type { Theme } from "@mariozechner/pi-coding-agent";

import type { ColorScheme, HudCoreConfig, SegmentContext, SegmentStateProvider } from "../shell/hud/types.js";
import { getPreset } from "../shell/hud/presets.js";
import { getGitStatus } from "../shell/hud/git-status.js";
import { getDefaultColors } from "../shell/hud/theme.js";

/**
 * 세션 이벤트에서 사용량 통계를 추출하여 SegmentContext를 구성.
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
  const selectedModel = provider.selectedModel ?? ctx?.model;

  // ctx getter(sessionManager, modelRegistry)는 stale ctx에서 assertActive() throw 가능.
  // selectedModel 등 ctx-independent 데이터는 throw 시에도 반환되어야 하므로 내부 try/catch.
  let input = 0, output = 0, cost = 0;
  let thinkingLevelFromSession = "off";
  let sessionId: string | undefined;
  let usingSubscription = false;

  try {
    const sessionEvents = ctx?.sessionManager?.getBranch?.() ?? [];
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
        cost += m.usage.cost.total;
      }
    }
    sessionId = ctx?.sessionManager?.getSessionId?.();
    usingSubscription = selectedModel
      ? ctx?.modelRegistry?.isUsingOAuth?.(selectedModel) ?? false
      : false;
  } catch {
    // stale ctx — 사용량/세션 데이터는 이전 값 유지, selectedModel은 정상 반환
  }

  const gitBranch = provider.footerDataRef?.getGitBranch() ?? null;
  const gitStatus = getGitStatus(gitBranch);

  return {
    model: selectedModel,
    thinkingLevel: thinkingLevelFromSession || provider.getThinkingLevelFn?.() || "off",
    sessionId,
    usageStats: { input, output, cost },
    usingSubscription,
    sessionStartTime: provider.sessionStartTime,
    git: gitStatus,
    extensionStatuses: provider.footerDataRef?.getExtensionStatuses() ?? new Map(),
    options: presetDef.segmentOptions ?? {},
    theme,
    colors,
  };
}
