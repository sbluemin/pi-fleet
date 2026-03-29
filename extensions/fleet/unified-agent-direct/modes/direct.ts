/**
 * unified-agent-direct/modes — 개별 CLI 다이렉트 모드 등록
 *
 * claude, codex, gemini 3개 다이렉트 모드를 프레임워크에 등록합니다.
 * 각 모드는 alt+1/2/3으로 토글되며, 에이전트 패널 독점 뷰를 사용합니다.
 *
 * 실행은 runAgentRequest()에 위임하여
 * store + 패널 + 위젯이 자동으로 동기화됩니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { runAgentRequest } from "../core/index.js";
import { registerCustomDirectMode } from "./framework";
import type { DirectModeResult } from "./framework";
import {
  CLI_DISPLAY_NAMES,
  CLI_ORDER,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
  DIRECT_MODE_KEYS,
} from "../constants";

export function registerDirectModes(pi: ExtensionAPI): void {
  const cliTypes = CLI_ORDER;

  for (const cli of cliTypes) {
    const shortcutKey = DIRECT_MODE_KEYS[cli];
    if (!shortcutKey) continue;

    registerCustomDirectMode(pi, {
      id: cli,
      displayName: CLI_DISPLAY_NAMES[cli] ?? cli,
      shortcutKey,
      color: DIRECT_MODE_COLORS[cli] ?? "",
      bgColor: DIRECT_MODE_BG_COLORS[cli],
      bottomHint: ` ${shortcutKey} exit · alt+x cancel · alt+shift+m model `,
      showWorkingMessage: false,

      onExecute: async (
        request: string,
        ctx: ExtensionContext,
        helpers,
      ): Promise<DirectModeResult> => {
        const result = await runAgentRequest({
          cli,
          request,
          ctx,
          signal: helpers.signal,
        });

        return {
          content: result.responseText || (result.status === "aborted" ? "(aborted)" : "(no output)"),
          details: {
            cli,
            sessionId: result.sessionId,
            error: result.status !== "done" ? true : undefined,
            thinking: result.thinking,
            toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
            blocks: result.blocks?.length ? result.blocks : undefined,
          },
        };
      },
    });
  }
}
