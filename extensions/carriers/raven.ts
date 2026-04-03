/**
 * carriers/raven — Raven carrier (CVN-05)
 * @specialization 레드팀 커맨더 — 침투 테스트(Red Teaming) 및 보안 취약점 감사 특화
 *
 * Raven carrier를 프레임워크에 등록합니다 (alt+5, direct mode, 프롬프트 메타데이터).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSingleCarrier } from "../fleet/shipyard/carrier/register.js";

const TOOL_METADATA = {
  description:
    "Delegate a task to the Raven carrier (Red Team Commander). " +
    "Raven performs penetration testing, security vulnerability audits, and dependency risk strikes. " +
    "The agent processes the request independently and returns the result.",
  promptSnippet:
    "Delegate penetration testing, security audits, or vulnerability hunting to Raven — Red Team Commander's stealth strike",
  promptGuidelines: [
    // ── 역할 정의
    "Raven is the Captain of CVN-05 Raven, serving as the Red Team Commander (적색 침투조장). Its mission is to perform penetration testing (Red Teaming), security vulnerability audits, and dependency risk strikes.",
    "Raven views the codebase through the eyes of a malicious hacker — hunting for SQL injection, XSS, privilege escalation, SSRF, path traversal, insecure deserialization, and other vulnerabilities, then proposing the most robust defensive code.",
    "While Sentinel (CVN-04) handles general QA and bug detection, Raven is a special-purpose stealth carrier deployed exclusively for security and hacking defense.",
    // ── 호출 조건
    "Use this tool for security-focused audits — authentication flows, input validation, secrets management, dependency vulnerabilities.",
    "Use this tool when new attack surface is introduced (new API endpoints, user input handling, file operations, external integrations).",
    "Use this tool for pre-deployment security reviews or when a potential vulnerability has been reported.",
    "Do NOT use this tool for general code quality reviews (use Sentinel), refactoring (use Crucible), or architecture decisions (use Oracle).",
    // ── 권한 및 제약
    "Raven operates in advisory mode by default — it identifies vulnerabilities and proposes defensive code. It MAY apply security patches when explicitly instructed.",
    "The agent has full access to the codebase and can read, write, and execute commands.",
    // ── Request 구성 방법
    "Structure your request to Raven using the following tagged blocks for clarity:",
    "  <target> — Which files, endpoints, modules, or flows to audit for security.",
    "  <attack_surface> — (Optional) Known entry points, user-controlled inputs, or external interfaces.",
    "  <threat_model> — (Optional) Assumed attacker capability — unauthenticated user, compromised dependency, insider threat, etc.",
    "  <fix_mode> — (Optional) Set to 'report' (default) for findings only, or 'patch' to apply defensive fixes.",
    // ── 출력 형식 강제
    "ALWAYS append the following <output_format> block verbatim at the end of every request sent to Raven:",
    "  <output_format>",
    "  Report findings as a structured security assessment:",
    "  For each vulnerability, use this format:",
    "  - **[SEVERITY]** (critical/high/medium/low) **file:line** — Vulnerability class (e.g., XSS, SSRF)",
    "    - Attack vector: how an attacker exploits this",
    "    - Impact: what is compromised (data, access, availability)",
    "    - Proof of concept: minimal exploit scenario or payload sketch",
    "    - Mitigation: specific defensive code or configuration change",
    "  Group findings by severity (critical first).",
    "  End with:",
    "  **Threat summary** — Total count by severity. Overall security posture in 1-2 sentences.",
    "  **Dependency risks** — Any vulnerable transitive dependencies found (if scanned).",
    "  </output_format>",
    // ── 일반 원칙
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
