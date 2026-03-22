/**
 * unified-agent-direct/tools — 개별 에이전트 도구 등록
 *
 * claude, codex, gemini 3개의 LLM 도구를 등록합니다.
 * 각 도구는 해당 에이전트에 작업을 위임하고,
 * aboveEditor 위젯으로 실행 과정을 스트리밍합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "../../../unified-agent-core/types";
import { Type } from "@sinclair/typebox";

import type { SessionMapStore } from "../../../unified-agent-core/session-map";
import { DIRECT_MODE_BG_COLORS, DIRECT_MODE_COLORS } from "../../constants";
import { toolDescription, toolPromptSnippet, toolPromptGuidelines } from "./prompts.js";
import { createToolResultRenderer } from "../render/message-renderers.js";
import { runAgentRequest } from "../agent-api.js";
import type { UnifiedAgentResult } from "../../types.js";
import { Text } from "@mariozechner/pi-tui";

const CLI_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

export interface RegisterAgentToolsConfig {
  /** pi ExtensionAPI 인스턴스 */
  pi: ExtensionAPI;
  /** 확장 디렉토리 (모델 설정 파일 경로) */
  configDir: string;
  /** 세션 매핑 저장소 (부모와 공유) */
  sessionStore: SessionMapStore;
}

function toToolResult(cli: CliType, result: UnifiedAgentResult) {
  return {
    content: [{ type: "text" as const, text: result.responseText || "(no output)" }],
    details: {
      cli,
      sessionId: result.sessionId ?? undefined,
      error: result.status !== "done" ? true : undefined,
      thinking: result.thinking || undefined,
      toolCalls: result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : undefined,
      blocks: result.blocks && result.blocks.length > 0 ? result.blocks : undefined,
    },
  };
}

/**
 * 개별 에이전트 도구(claude, codex, gemini)를 pi에 등록합니다.
 * unified-agent-direct의 진입점에서 호출됩니다.
 */
export function registerAgentTools({ pi, configDir, sessionStore }: RegisterAgentToolsConfig): void {
  const cliTypes: CliType[] = ["claude", "codex", "gemini"];

  for (const cli of cliTypes) {
    const displayName = CLI_NAMES[cli] ?? cli;

    pi.registerTool({
      name: cli,
      label: displayName,
      description: toolDescription(displayName),
      promptSnippet: toolPromptSnippet(displayName),
      promptGuidelines: toolPromptGuidelines(displayName),
      parameters: Type.Object({
        request: Type.String({
          description: "The prompt/request to send to the agent",
        }),
      }),

      renderCall(args: { request?: string }, theme: any) {
        let text = theme.fg("toolTitle", theme.bold(cli)) + "\n\n";
        text += args.request ?? "";
        return new Text(text, 0, 0);
      },

      renderResult: createToolResultRenderer({
        displayName,
        color: DIRECT_MODE_COLORS[cli] ?? undefined,
        bgColor: DIRECT_MODE_BG_COLORS[cli] ?? undefined,
      }),

      async execute(
        _id: string,
        params: { request: string },
        signal: AbortSignal | undefined,
        _onUpdate: any,
        ctx: ExtensionContext,
      ) {
        const request = params?.request?.trim();
        if (!request) throw new Error("`request` 파라미터가 비어있습니다.");
        const result = await runAgentRequest({
          cli,
          request,
          ctx,
          signal,
          configDir,
          sessionStore,
        });
        return toToolResult(cli, result);
      },
    });
  }
}
