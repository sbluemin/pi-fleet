import type { BridgeCommandSpec, BridgeLaunchContext } from "./types.js";
import { BRIDGE_TITLE_PREFIX } from "./types.js";

export function buildBridgeCommand(context: BridgeLaunchContext): BridgeCommandSpec {
  switch (context.cli) {
    case "claude":
      return {
        command: buildClaudeCommand(context),
        cwd: context.cwd,
        title: `${BRIDGE_TITLE_PREFIX} · Claude`,
      };
    case "codex":
      return {
        command: buildCodexCommand(context),
        cwd: context.cwd,
        title: `${BRIDGE_TITLE_PREFIX} · Codex`,
      };
    case "gemini":
      return {
        command: buildGeminiCommand(context),
        cwd: context.cwd,
        title: `${BRIDGE_TITLE_PREFIX} · Gemini`,
      };
  }

  throw new Error(`Unsupported bridge CLI: ${String(context.cli)}`);
}

function buildClaudeCommand(context: BridgeLaunchContext): string {
  const args = ["claude", "--dangerously-skip-permissions"];
  if (context.sessionId) {
    args.push("--resume", shellQuote(context.sessionId));
  }
  if (context.model) {
    args.push("--model", shellQuote(context.model));
  }
  if (context.effort) {
    args.push("--effort", shellQuote(context.effort));
  }
  return args.join(" ");
}

function buildCodexCommand(context: BridgeLaunchContext): string {
  const args = ["codex", "--full-auto"];
  if (context.sessionId) {
    args.push("resume", shellQuote(context.sessionId));
  }
  if (context.model) {
    args.push("-m", shellQuote(context.model));
  }
  if (context.effort) {
    args.push("-c", shellQuote(`model_reasoning_effort="${context.effort}"`));
  }
  return args.join(" ");
}

function buildGeminiCommand(context: BridgeLaunchContext): string {
  const args = ["gemini", "--yolo"];
  if (context.sessionId) {
    args.push("--resume", shellQuote(context.sessionId));
  }
  if (context.model) {
    args.push("--model", shellQuote(context.model));
  }
  return args.join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
