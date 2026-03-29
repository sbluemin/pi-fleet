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
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate task to Gemini — independent agent execution with live streaming",
  promptGuidelines: [
    "Use this tool to delegate a coding task to Gemini.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
  ],
};

export function registerGeminiCaptain(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  });
}
