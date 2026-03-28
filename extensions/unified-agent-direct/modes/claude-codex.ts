/**
 * unified-agent-direct/modes — Claude & Codex 모드 (2에이전트 동시 질의)
 *
 * alt+9로 토글되며, claude/codex 2개 에이전트에
 * 동시에 질의하고 에이전트 패널 2분할 뷰로 결과를 표시합니다.
 *
 * All 모드(3에이전트)에서 Gemini를 제외한 변형입니다.
 * 각 에이전트 실행은 runAgentRequest()에 위임하여
 * store + 패널 + 위젯이 자동으로 동기화됩니다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import type { SessionMapStore } from "../core/agent/session-map";
import { runAgentRequest } from "../core/agent-api.js";
import { registerCustomDirectMode } from "./framework";
import {
  startAgentStreaming,
  stopAgentStreaming,
  getAgentPanelCols,
} from "../core/panel/lifecycle.js";
import type { AgentCol } from "../core/contracts.js";
import {
  CLI_DISPLAY_NAMES,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
} from "../constants";
import { crossReportPrompt } from "./prompts";

/** 대상 CLI 목록 (Gemini 제외) */
const TARGET_CLIS = ["claude", "codex"] as const;

/** 칼럼 결과를 마크다운 텍스트로 통합 */
function colsToMarkdown(cols: AgentCol[]): string {
  return cols.map((c) => {
    const nm = CLI_DISPLAY_NAMES[c.cli] ?? c.cli;
    const s = c.status === "done" ? "✓" : "✗";
    return `## ${s} ${nm}\n\n${c.text.trim() || "(no output)"}`;
  }).join("\n\n---\n\n");
}

/**
 * Claude & Codex 다이렉트 모드를 등록합니다 (alt+9).
 */
export function registerClaudeCodexMode(
  pi: ExtensionAPI,
  configDir: string,
  sessionStore: SessionMapStore,
): void {
  registerCustomDirectMode(pi, {
    id: "claude-codex",
    displayName: "Claude & Codex",
    shortcutKey: "alt+9",
    color: DIRECT_MODE_COLORS["claude-codex"]!,
    bgColor: DIRECT_MODE_BG_COLORS["claude-codex"],
    bottomHint: " alt+9 exit · alt+x cancel · alt+shift+m model ",
    showWorkingMessage: false,
    clis: TARGET_CLIS,

    onExecute: async (request, ctx, helpers) => {
      // 전체 패널 리셋 + 확장 (2개 CLI만 칼럼 생성)
      startAgentStreaming(ctx, { expand: true, clis: TARGET_CLIS });

      // 2개 에이전트 동시 실행
      await Promise.allSettled(
        TARGET_CLIS.map((cli: CliType) =>
          runAgentRequest({
            cli,
            request,
            ctx,
            signal: helpers.signal,
            configDir,
            sessionStore,
          }),
        ),
      );

      // 전체 스트리밍 종료
      stopAgentStreaming(ctx);

      const finalCols = getAgentPanelCols();
      const rawContent = colsToMarkdown(finalCols);

      // 2개 에이전트 모두 성공하면 교차 보고서 자동 생성
      const doneCount = finalCols.filter((c) => c.status === "done").length;
      if (doneCount >= 2) {
        const prompt = crossReportPrompt(
          request,
          finalCols
            .filter((c) => c.status === "done")
            .map((c) => ({
              cli: c.cli,
              displayName: CLI_DISPLAY_NAMES[c.cli] ?? c.cli,
              text: c.text,
            })),
        );
        // executeDirectMode가 claude-codex-response 메시지를 전송한 후 실행되도록 지연
        setTimeout(() => {
          pi.sendUserMessage(prompt);
        }, 0);
      }

      return {
        content: rawContent,
        details: {
          cli: "claude-codex",
          columns: finalCols.map((c) => ({ cli: c.cli, status: c.status })),
        },
      };
    },
  });
}
