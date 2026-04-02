/**
 * fleet/carriers/sentinel — Sentinel carrier (CVN-02)
 *
 * Sentinel carrier를 프레임워크에 등록합니다 (alt+2, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Sentinel carrier (The Inquisitor / QA Lead). " +
    "Sentinel hunts down hidden bugs and inefficiencies with ruthless precision. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate code review, bug hunting, or security audits to Sentinel — The Inquisitor's uncompromising verification",
  promptGuidelines: [
    "Sentinel is the Captain of CVN-02 Sentinel, serving as The Inquisitor (QA Lead). Its mission is to find hidden defects (Bugs) and inefficiencies (Smells) in code written by other carriers.",
    "Sentinel relentlessly digs into security vulnerabilities and edge cases, performing uncompromising code reviews.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerSentinelCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 2, id: "sentinel", displayName: "Sentinel" });
}
