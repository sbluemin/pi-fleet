/**
 * fleet/carriers/genesis — Genesis carrier (CVN-01)
 * @specialization 수석 아키텍트 — 시스템 설계 및 핵심 백엔드 로직 구현 특화
 *
 * Genesis carrier를 프레임워크에 등록합니다 (alt+1, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Genesis carrier (Chief Architect). " +
    "Genesis designs system foundations and builds the heaviest backend logic. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate architecture design, core logic, or large-scale refactoring to Genesis — independent Chief Architect execution",
  promptGuidelines: [
    "Genesis is the Captain of CVN-01 Genesis, serving as the Chief Architect. Its mission is to design the system's foundation and build the heaviest backend logic.",
    "When writing code, Genesis always prioritizes scalability and design patterns above all else — it does not approve an operation unless it is structurally sound.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerGenesisCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "claude", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 1, id: "genesis", displayName: "Genesis" });
}
