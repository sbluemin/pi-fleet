/**
 * unified-agent-direct/modes — All 모드 (3에이전트 동시 질의)
 *
 * alt+0으로 토글되며, claude/codex/gemini 3개 에이전트에
 * 동시에 질의하고 에이전트 패널 3분할 뷰로 결과를 표시합니다.
 *
 * 각 에이전트 실행은 runAgentRequest()에 위임하여
 * store + 패널 + 위젯이 자동으로 동기화됩니다.
 * 패널 라이프사이클(startAgentStreaming/stopAgentStreaming)은
 * All 모드 고유의 전체 리셋이 필요하므로 직접 관리합니다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import type { AgentCol } from "../core/index.js";
import {
  runAgentRequest,
  startAgentStreaming,
  stopAgentStreaming,
  getAgentPanelCols,
} from "../core/index.js";
import { registerCustomDirectMode } from "./framework";
import {
  CLI_DISPLAY_NAMES,
  CLI_ORDER,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
} from "../constants";
import { crossReportPrompt } from "./prompts";

function colsToMarkdown(cols: AgentCol[]): string {
  return cols.map((c) => {
    const nm = CLI_DISPLAY_NAMES[c.cli] ?? c.cli;
    const s = c.status === "done" ? "✓" : "✗";
    return `## ${s} ${nm}\n\n${c.text.trim() || "(no output)"}`;
  }).join("\n\n---\n\n");
}

export function registerAllMode(pi: ExtensionAPI): void {
  const cliTypes = CLI_ORDER;

  registerCustomDirectMode(pi, {
    id: "all",
    displayName: "All",
    shortcutKey: "alt+0",
    color: DIRECT_MODE_COLORS["all"]!,
    bgColor: DIRECT_MODE_BG_COLORS["all"],
    bottomHint: " alt+0 exit · alt+x cancel · alt+shift+m model ",
    showWorkingMessage: false,
    clis: cliTypes,

    onExecute: async (request, ctx, helpers) => {
      startAgentStreaming(ctx, { expand: true });

      await Promise.allSettled(
        cliTypes.map((cli: CliType) =>
          runAgentRequest({
            cli,
            request,
            ctx,
            signal: helpers.signal,
          }),
        ),
      );

      stopAgentStreaming(ctx);

      const finalCols = getAgentPanelCols();
      const rawContent = colsToMarkdown(finalCols);

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
        setTimeout(() => {
          pi.sendUserMessage(prompt);
        }, 0);
      }

      return {
        content: rawContent,
        details: {
          cli: "all",
          columns: finalCols.map((c) => ({ cli: c.cli, status: c.status })),
        },
      };
    },
  });
}
