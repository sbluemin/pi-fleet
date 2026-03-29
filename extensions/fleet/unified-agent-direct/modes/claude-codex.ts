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
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
} from "../constants";
import { crossReportPrompt } from "./prompts";

const TARGET_CLIS = ["claude", "codex"] as const;

function colsToMarkdown(cols: AgentCol[]): string {
  return cols.map((c) => {
    const nm = CLI_DISPLAY_NAMES[c.cli] ?? c.cli;
    const s = c.status === "done" ? "✓" : "✗";
    return `## ${s} ${nm}\n\n${c.text.trim() || "(no output)"}`;
  }).join("\n\n---\n\n");
}

export function registerClaudeCodexMode(pi: ExtensionAPI): void {
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
      startAgentStreaming(ctx, { expand: true, clis: TARGET_CLIS });

      await Promise.allSettled(
        TARGET_CLIS.map((cli: CliType) =>
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
          cli: "claude-codex",
          columns: finalCols.map((c) => ({ cli: c.cli, status: c.status })),
        },
      };
    },
  });
}
