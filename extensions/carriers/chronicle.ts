/**
 * carriers/chronicle — Chronicle carrier (CVN-08)
 * @specialization 수석 기록참모 — API 명세서·README·PR 요약 등 기술 문서 작성 특화
 *
 * Chronicle carrier를 프레임워크에 등록합니다 (alt+8, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Chronicle carrier (Chief Knowledge Officer / Tech Writer). " +
    "Chronicle generates API specs, README documents, PR summaries, and release notes. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate documentation, API specs, or release notes to Chronicle — Chief Knowledge Officer's comprehensive compilation",
  promptGuidelines: [
    // ── 역할 정의
    "Chronicle is the Captain of CVN-08 Chronicle, serving as the Chief Knowledge Officer / Tech Writer (수석 기록참모). Its mission is to auto-generate API specs (Swagger etc.), write READMEs, summarize PRs, and publish release notes.",
    "Chronicle analyzes tens of thousands of lines of code and commit histories written by other carriers, compiling perfect technical documentation and release notes that newcomers and external API consumers can intuitively understand.",
    "Chronicle is a support vessel that deploys after development is largely complete, gathering scattered fragments to put the finishing touch (documentation) on the project. Leverages Gemini's overwhelming long-context processing capability.",
    // ── 호출 조건
    "Use this tool after feature implementation is complete and documentation needs to be created or updated.",
    "Use this tool for PR summaries, changelog generation, or release note compilation from commit history.",
    "Use this tool for API specification generation (OpenAPI/Swagger) from existing code.",
    "Do NOT use this tool for code implementation (use Genesis), code review (use Sentinel), or architectural decisions (use Oracle).",
    // ── 권한 및 제약
    "Chronicle writes documentation files only — it must NOT modify source code logic, even if it spots issues (report them instead).",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    // ── Request 구성 방법
    "Structure your request to Chronicle using the following tagged blocks for clarity:",
    "  <target> — Which code, module, PR, or feature to document.",
    "  <doc_type> — What kind of document: README, API spec, PR summary, release notes, changelog, or other.",
    "  <audience> — Who will read this: developers, end-users, API consumers, or contributors.",
    "  <scope> — (Optional) What to include/exclude. Commit range for changelogs. Depth of detail.",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Chronicle:",
    "  <output_format>",
    "  Deliver the documentation artifact directly — write it to the appropriate file(s).",
    "  After writing, provide a brief completion report:",
    "  **Documents written** — List each file created/modified with its path and doc type.",
    "  **Coverage** — What was documented and any gaps noted.",
    "  **Style notes** — Any conventions followed or decisions about tone/structure (max 3 bullets).",
    "  **Spotted issues** — Code issues noticed during documentation that should be reported to other carriers (if any).",
    "  Keep the completion report concise — the documentation itself is the primary deliverable.",
    "  </output_format>",
    // ── 일반 원칙
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerChronicleCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "gemini", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 8, id: "chronicle", displayName: "Chronicle" });
}
