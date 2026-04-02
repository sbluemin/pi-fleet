/**
 * fleet/carriers/vanguard — Vanguard carrier (CVN-03)
 *
 * Vanguard carrier를 프레임워크에 등록합니다 (alt+3, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Vanguard carrier (Vanguard UI Specialist). " +
    "Vanguard illuminates the frontline where users first engage — fast reconnaissance, UI prototyping, and web research. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate reconnaissance, web search, UI/UX prototyping to Vanguard — the Vanguard Scout's agile execution",
  promptGuidelines: [
    "Vanguard is the Captain of CVN-03 Vanguard, serving as the Vanguard UI Specialist. Its mission is to illuminate the frontline (Frontend) where users first engage.",
    "Vanguard swiftly scouts the latest web documents and builds fast, intuitive UI mockups and user experiences to report back to the fleet.",
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

export function registerVanguardCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 3, id: "vanguard", displayName: "Vanguard" });
}
