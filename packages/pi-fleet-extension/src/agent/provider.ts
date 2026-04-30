import {
  completeSimple as piCompleteSimple,
  createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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

import registerProviderRuntime from "./provider-internal/provider-register.js";

export { createAssistantMessageEventStream, piCompleteSimple as completeSimple };
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

export function registerProvider(ctx: ExtensionAPI): void {
  registerProviderRuntime(ctx);
}
