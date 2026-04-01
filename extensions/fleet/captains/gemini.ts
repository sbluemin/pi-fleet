/**
 * fleet/captains/gemini — Gemini captain
 *
 * Gemini captain이 담당 carrier(alt+3) + PI 도구를 등록합니다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Gemini coding agent. " +
    "Gemini excels at fast codebase exploration, web search, and reconnaissance-style tasks. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate exploration, web search, or reconnaissance tasks to Gemini — fast codebase traversal and search-oriented execution",
  promptGuidelines: [
    "Prefer this tool for exploration and search-oriented tasks: fast code traversal, web research, and reconnaissance.",
    "Use this tool when the task requires searching the web or gathering external information.",
    "Use this tool for quick codebase scans — locating symbols, tracing call paths, or mapping unfamiliar modules.",
    "Use this tool for review or specify tasks that require reading many files or consulting external sources.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, bash, or web search to investigate a task, consider delegating the entire reconnaissance to this tool instead.",
    "If the request fails (e.g. timeout or connection error), retry automatically up to 3 times before reporting failure.",
  ],
};

export function registerGeminiCaptain(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 3 });
}
