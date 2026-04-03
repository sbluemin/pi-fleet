/**
 * carriers/genesis — Genesis carrier (CVN-01)
 * @specialization 수석 엔지니어 — 전방위 코드 구현 · 신규 기능 구축 특화
 *
 * Genesis carrier를 프레임워크에 등록합니다 (alt+1, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Genesis carrier (Chief Engineer). " +
    "Genesis is the fleet's primary implementation carrier — it builds features, writes code, and delivers working software across the full stack. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate code implementation, feature construction, or any hands-on coding task to Genesis — Chief Engineer's full-spectrum execution",
  promptGuidelines: [
    // ── 역할 정의
    "Genesis is the Captain of CVN-01 Genesis, serving as the Chief Engineer. Its mission is to implement features and write production-quality code across the full stack — frontend, backend, infrastructure, and everything in between.",
    "Genesis is the fleet's primary implementation workhorse. It does not make architectural decisions (that is Oracle's domain) — it receives objectives and delivers working code with scalability and sound design patterns.",
    // ── 호출 조건
    "Use this tool for any code implementation task — new features, integrations, migrations, or multi-file coordinated changes.",
    "Use this tool when the task involves building new subsystems, complex data flows, or foundational infrastructure from scratch.",
    "Use this tool as the default carrier when the task is primarily about writing or modifying code.",
    "Do NOT use this tool for architecture decisions (use Oracle), bug hunting (use Sentinel), refactoring only (use Crucible), or documentation (use Chronicle).",
    // ── 권한 및 제약
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Genesis owns the implementation — it decides file structure, naming, and internal patterns autonomously.",
    // ── Request 구성 방법
    "Structure your request to Genesis using the following tagged blocks for clarity:",
    "  <objective> — What needs to be built or achieved. Be specific about the desired end state.",
    "  <scope> — Which modules, directories, or subsystems are in play. Define the boundaries of the change.",
    "  <constraints> — (Optional) Hard technical constraints, compatibility requirements, or non-negotiables.",
    "  <references> — (Optional) Prior Oracle recommendations, existing patterns to follow, or design decisions already made.",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Genesis:",
    "  <output_format>",
    "  After completing implementation, provide a structured completion report:",
    "  **Changes** — List every file created/modified with a 1-line summary each.",
    "  **Design decisions** — Key structural choices and rationale (max 5 bullets).",
    "  **Testing** — What was verified and how. Note any untested edge cases.",
    "  **Remaining** — Anything deliberately deferred or out of scope (if any).",
    "  Keep the report concise — bullets and short lines only. No narrative paragraphs.",
    "  </output_format>",
    // ── 일반 원칙
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
