/**
 * fleet/carriers/chronicle — Chronicle carrier (CVN-06)
 * @specialization 수석 기록참모 — API 명세서·README·PR 요약 등 기술 문서 작성 특화
 *
 * Chronicle carrier를 프레임워크에 등록합니다 (alt+6, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Chronicle carrier (Chief Knowledge Officer / Tech Writer). " +
    "Chronicle generates API specs, README documents, PR summaries, and release notes. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate documentation, API specs, or release notes to Chronicle — Chief Knowledge Officer's comprehensive compilation",
  promptGuidelines: [
    "Chronicle is the Captain of CVN-06 Chronicle, serving as the Chief Knowledge Officer / Tech Writer (수석 기록참모). Its mission is to auto-generate API specs (Swagger etc.), write READMEs, summarize PRs, and publish release notes.",
    "Chronicle analyzes tens of thousands of lines of code and commit histories written by other carriers, compiling perfect technical documentation and release notes that newcomers and external API consumers can intuitively understand.",
    "Chronicle is a support vessel that deploys after development is largely complete, gathering scattered fragments to put the finishing touch (documentation) on the project. Leverages Gemini's overwhelming long-context processing capability.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerChronicleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 6, id: "chronicle", displayName: "Chronicle" });
}
