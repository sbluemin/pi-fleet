/**
 * unified-agent-direct/tools — 개별 에이전트 도구 등록
 *
 * claude, codex, gemini 3개의 LLM 도구를 등록합니다.
 * 각 도구는 해당 에이전트에 작업을 위임하고,
 * aboveEditor 위젯으로 실행 과정을 스트리밍합니다.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "../../unified-agent-core/types";
import { Type } from "@sinclair/typebox";

import type { SessionMapStore } from "../../unified-agent-core/session-map";
import { executeWithPool } from "../../unified-agent-core/executor";
import { createStreamingWidget } from "./streaming-widget";
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
      description:
        `Delegate a task to the ${displayName} coding agent. ` +
        "The agent processes the request independently and returns the result.",
      promptSnippet:
        `Delegate task to ${displayName} — independent agent execution with live streaming`,
      promptGuidelines: [
        `Use this tool to delegate a coding task to ${displayName}.`,
        "The agent has full access to the codebase and can read, write, and execute commands.",
        "Provide a clear, self-contained request — the agent does not share your conversation context.",
      ],
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

      async execute(
        _id: string,
        params: { request: string },
        signal: AbortSignal | undefined,
        _onUpdate: any,
        ctx: ExtensionContext,
      ) {
        const request = params?.request?.trim();
        if (!request) throw new Error("`request` 파라미터가 비어있습니다.");

        const widget = createStreamingWidget(ctx, cli);

        try {
          const result = await executeWithPool({
            cli,
            request,
            cwd: ctx.cwd,
            configDir,
            sessionStore,
            signal,
            onMessageChunk: (text) => widget.onMessage(text),
            onThoughtChunk: (text) => widget.onThought(text),
            onToolCall: (title, status) => widget.onToolCall(title, status),
            onStatusChange: (status) => widget.onStatus(status),
          });

          widget.finish();

          const collected = widget.getCollectedData();
          return {
            content: [{ type: "text" as const, text: result.responseText || "(no output)" }],
            details: {
              cli,
              sessionId: result.connectionInfo?.sessionId ?? undefined,
              error: result.status !== "done" ? true : undefined,
              thinking: collected.thinking || undefined,
              toolCalls: collected.toolCalls.length > 0 ? collected.toolCalls : undefined,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          widget.fail(message);
          throw error;
        } finally {
          widget.destroy();
        }
      },
    });
  }
}
