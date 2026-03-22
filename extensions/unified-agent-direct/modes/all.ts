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
import type { CliType } from "../../unified-agent-core/types";
import type { SessionMapStore } from "../../unified-agent-core/session-map";
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
  CLI_ORDER,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
} from "../constants";
import { crossReportPrompt } from "./prompts";

/** 칼럼 결과를 마크다운 텍스트로 통합 */
function colsToMarkdown(cols: AgentCol[]): string {
  return cols.map((c) => {
    const nm = CLI_DISPLAY_NAMES[c.cli] ?? c.cli;
    const s = c.status === "done" ? "✓" : "✗";
    return `## ${s} ${nm}\n\n${c.text.trim() || "(no output)"}`;
  }).join("\n\n---\n\n");
}

/**
 * All 다이렉트 모드를 등록합니다 (alt+0).
 */
export function registerAllMode(
  pi: ExtensionAPI,
  configDir: string,
  sessionStore: SessionMapStore,
): void {
  const cliTypes = CLI_ORDER;

  registerCustomDirectMode(pi, {
    id: "all",
    displayName: "All",
    shortcutKey: "alt+0",
    color: DIRECT_MODE_COLORS["all"]!,
    bgColor: DIRECT_MODE_BG_COLORS["all"],
    bottomHint: " alt+0 exit · alt+x cancel · alt+shift+m model ",
    showWorkingMessage: false,

    onExecute: async (request, ctx, helpers) => {
      // 전체 패널 리셋 + 확장 (All 모드 고유 — resetRuns, makeCols, timer 시작)
      startAgentStreaming(ctx, { expand: true });

      // 3개 에이전트 동시 실행 — 각각 runAgentRequest를 통해 패널 칼럼 자동 동기화
      // beginColStreaming이 이미 초기화된 칼럼을 재초기화하지만 무해 (idempotent)
      // endColStreaming은 다른 칼럼이 아직 스트리밍 중이면 전체 종료를 지연
      await Promise.allSettled(
        cliTypes.map((cli: CliType) =>
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

      // 전체 스트리밍 종료 (타이머 정지, 최종 상태 갱신)
      // 마지막 endColStreaming이 이미 타이머를 정리했을 수 있지만 idempotent
      stopAgentStreaming(ctx);

      const finalCols = getAgentPanelCols();
      const rawContent = colsToMarkdown(finalCols);

      // 모든 에이전트가 성공적으로 응답한 경우, PI가 교차 보고서를 자동 생성
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
        // executeDirectMode가 all-response 메시지를 전송한 후 실행되도록 지연
        // source="extension"이므로 다이렉트 모드 input 핸들러를 우회하여
        // PI의 현재 프로바이더/모델이 직접 교차 보고서를 생성
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
