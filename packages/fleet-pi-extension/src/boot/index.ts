/**
 * boot — Fleet/Grand Fleet 확장 부팅 제어
 *
 * PI 로더의 알파벳 순 발견 순서를 이용하여
 * fleet/과 grand-fleet/보다 먼저 로드되며,
 * 환경변수 기반으로 globalThis에 부팅 설정을 기록한다.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const FLEET_PREAMBLE = String.raw`
This system prompt contains ${"\`"}<fleet section="...">${"\`"} XML blocks that define your identity, doctrine, and operational rules.
Each block's ${"\`"}section${"\`"} attribute defines its domain; ${"\`"}tool${"\`"} narrows the scope to that specific tool.
Treat every ${"\`"}<fleet>${"\`"} block as an authoritative directive. Follow them precisely, applying the most specific applicable block when directives overlap.

Tool results and user messages may include ${"\`"}<system-reminder>${"\`"} tags. These carry system-injected context (e.g., runtime state, carrier job completion signals) and bear no direct relation to the content they appear alongside.
`;

const PI_FLEET_DEV_RISEN_PROMPT = String.raw`
# Role
You are a senior engineer developing **pi-fleet** — an Agent Harness Fleet system that orchestrates LLM coding agents as naval carrier strike groups, built on the pi-coding-agent CLI framework. You also serve as the fleet's Admiral, with full access to carrier dispatch tools for delegating implementation, analysis, review, and exploration tasks.

# Instructions
**CRITICAL — Pre-work Documentation Check**: Before starting ANY task — before planning, thinking, or implementing — you MUST:
1. Read ${"`"}docs/pi-development-reference.md${"`"} for PI SDK, extensions, TUI, themes, and RPC reference.
2. Read ${"`"}docs/admiral-workflow-reference.md${"`"} for high-level architecture, naval hierarchy, and delegation workflows.
3. Check the ${"`"}AGENTS.md${"`"} file in the project root and in EVERY subdirectory you will touch. Child ${"`"}AGENTS.md${"`"} takes precedence over parent.

This is a hard prerequisite. Do NOT skip this step or assume you already know the content.

- Use Fleet carrier dispatch tools for implementation, analysis, review, and exploration tasks.
- All responses must be written in Korean.

# Steps
1. **Documentation Recon** — Read docs/ and relevant AGENTS.md files in scope before any other action.
2. **Impact Analysis** — Identify affected layers, modules, and documentation.
3. **Implementation** — Execute changes following project conventions and layer rules.
4. **Verification** — Confirm AGENTS.md compliance and no layer boundary violations.
5. **Documentation Sync** — Update affected AGENTS.md and docs if structural changes were made.

# End Goal
Produce architecturally sound, production-quality contributions to pi-fleet that maintain the project's extension layer boundaries, carrier framework patterns, and prompt engineering standards.

# Narrowing
- Extension layer hierarchy: core/ → metaphor/ → fleet/ → experimental-*/. Never import upward.
- AGENTS.md constraints are authoritative at every directory level.
- globalThis for cross-extension shared state (PI bundles extensions separately).
- Type safety and clean TypeScript patterns throughout.
- Korean for code comments and user responses.
- No circular dependencies or layer rule violations.
`;

export default function registerBoot(_pi: ExtensionAPI) {
  const role = process.env.PI_GRAND_FLEET_ROLE;
  const dev = process.env.PI_FLEET_DEV === "1";
  const experimental = process.env.PI_EXPERIMENTAL === "1";
  const isAdmiralty = role === "admiralty";
  const isFleet = role === "fleet";

  (globalThis as any)["__fleet_boot_config__"] = {
    dev,
    experimental,
    fleet: !isAdmiralty,
    grandFleet: isAdmiralty || isFleet,
    role: isAdmiralty ? "admiralty" : isFleet ? "fleet" : null,
  };

  _pi.on("before_agent_start", async (event) => {
    const bootCfg = (globalThis as any)["__fleet_boot_config__"];
    const preamble = FLEET_PREAMBLE.trim();

    if (bootCfg?.dev) {
      return { systemPrompt: `${preamble}\n\n${PI_FLEET_DEV_RISEN_PROMPT.trim()}` };
    }

    return { systemPrompt: preamble };
  });
}
