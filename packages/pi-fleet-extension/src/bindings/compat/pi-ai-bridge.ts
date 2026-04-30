import {
  completeSimple as piCompleteSimple,
  createAssistantMessageEventStream,
  StringEnum,
} from "@mariozechner/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingBudgets,
  ThinkingLevel,
  Tool,
} from "@mariozechner/pi-ai";
import type { LlmClient, LlmCompleteRequest, LlmCompleteResult } from "@sbluemin/fleet-core";

export { createAssistantMessageEventStream, piCompleteSimple as completeSimple, StringEnum };
export type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingBudgets,
  ThinkingLevel,
  Tool,
};

export function createPiAiLlmClient(): LlmClient {
  return {
    async complete(request: LlmCompleteRequest): Promise<LlmCompleteResult> {
      const model = request.model as unknown as Model<Api>;
      const response = await piCompleteSimple(
        model,
        {
          systemPrompt: request.systemPrompt,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })) as never,
        },
        request.thinking ? ({ thinking: request.thinking } as never) : undefined,
      );
      const content = typeof response === "string" ? response : response.content;
      return { text: typeof content === "string" ? content : JSON.stringify(content) };
    },
  };
}
