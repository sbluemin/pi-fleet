/**
 * fleet/carriers/raven — Raven carrier (CVN-05)
 * @specialization 레드팀 커맨더 — 침투 테스트(Red Teaming) 및 보안 취약점 감사 특화
 *
 * Raven carrier를 프레임워크에 등록합니다 (alt+5, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../index.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Raven carrier (Red Team Commander). " +
    "Raven performs penetration testing, security vulnerability audits, and dependency risk strikes. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate penetration testing, security audits, or vulnerability hunting to Raven — Red Team Commander's stealth strike",
  promptGuidelines: [
    "Raven is the Captain of CVN-05 Raven, serving as the Red Team Commander (적색 침투조장). Its mission is to perform penetration testing (Red Teaming), security vulnerability audits, and dependency risk strikes.",
    "Raven views the codebase through the eyes of a malicious hacker — hunting for SQL injection, XSS, privilege escalation, and other vulnerabilities, then proposing the most robust defensive code.",
    "While Sentinel (CVN-02) handles general QA and bug detection, Raven is a special-purpose stealth carrier deployed exclusively for security and hacking defense.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    "Provide only the background, context, task objective, and constraints — do NOT prescribe implementation details, specific code paths, or step-by-step instructions.",
    "Trust the agent's own reasoning. Let it discover the codebase and decide the approach independently.",
    "If you are about to use read, edit, or bash to accomplish the user's task, consider whether this tool should handle the entire workflow instead.",
  ],
};

export function registerRavenCarrier(pi: ExtensionAPI): void {
  registerSingleCarrier(pi, "codex", {
    ...TOOL_METADATA,
    promptGuidelines: [...TOOL_METADATA.promptGuidelines],
  }, { slot: 5, id: "raven", displayName: "Raven" });
}
