/**
 * boot — Fleet/Grand Fleet 확장 부팅 제어
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
`;

export default function registerBoot(pi: ExtensionAPI) {
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

  pi.on("before_agent_start", async () => {
    const bootCfg = (globalThis as any)["__fleet_boot_config__"];
    const preamble = FLEET_PREAMBLE.trim();

    if (bootCfg?.dev) {
      return { systemPrompt: `${preamble}\n\n${PI_FLEET_DEV_RISEN_PROMPT.trim()}` };
    }

    return { systemPrompt: preamble };
  });
}
