/**
 * unified-agent-direct — 에이전트 팝업 명령어 빌더
 *
 * 현재 활성 CLI의 sessionId로 resume하거나,
 * 세션이 없으면 신규 인터랙티브 모드로 실행합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import { getModelConfig, getSessionId } from "../core/index.js";

const CLI_COMMANDS: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

export interface PopupCommandOptions {
  agentId: CliType;
}

export function buildAgentPopupCommand(
  opts: PopupCommandOptions,
  _ctx: ExtensionContext,
): string {
  const { agentId } = opts;
  const cliConfig = getModelConfig()[agentId];
  const sessionId = getSessionId(agentId);
  const command = CLI_COMMANDS[agentId] ?? agentId;
  const model = cliConfig?.model;
  const effort = cliConfig?.effort;
  const args = buildResumeOrNewArgs(agentId, sessionId, model, effort);
  return joinCommand(command, args);
}

function buildResumeOrNewArgs(
  cli: CliType,
  sessionId: string | undefined,
  model: string | undefined,
  effort: string | undefined,
): string[] {
  const args: string[] = [];

  if (cli === "claude") {
    args.push("--dangerously-skip-permissions");
  } else if (cli === "codex") {
    args.push("--full-auto");
  } else if (cli === "gemini") {
    args.push("--yolo");
  }

  if (sessionId) {
    switch (cli) {
      case "claude":
        args.push("--resume", sessionId);
        break;
      case "codex":
        args.push("resume", sessionId);
        break;
      case "gemini":
        args.push("--resume", sessionId);
        break;
    }
  }

  if (model) {
    if (cli === "codex") {
      args.push("-m", model);
    } else {
      args.push("--model", model);
    }
  }

  if (cli === "claude" && effort) {
    args.push("--effort", effort);
  }
  if (cli === "codex" && effort) {
    args.push("-c", `model_reasoning_effort="${effort}"`);
  }

  return args;
}

function joinCommand(command: string, args: string[]): string {
  return [shellQuote(command), ...args.map((arg) => shellQuote(arg))].join(" ");
}

function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
