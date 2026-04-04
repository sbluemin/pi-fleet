/**
 * fleet/carrier/launch.ts — Carrier 브리지 커맨드 조립
 *
 * 각 carrier의 네이티브 CLI 브리지 실행 커맨드를
 * carrierId + cliType 기준으로 중앙에서 조립합니다.
 */

import type { CliType } from "@sbluemin/unified-agent";
import { getModelConfig, getSessionId } from "../../../core/agent/runtime.js";

interface LaunchConfig {
  command: string;
  baseArgs: string[];
  buildSessionArgs?: (sessionId: string) => string[];
  buildModelArgs?: (model: string) => string[];
  buildEffortArgs?: (effort: string) => string[];
}

const LAUNCH_CONFIGS: Record<CliType, LaunchConfig> = {
  claude: {
    command: "claude",
    baseArgs: ["--dangerously-skip-permissions"],
    buildSessionArgs: (sessionId) => ["--resume", sessionId],
    buildModelArgs: (model) => ["--model", model],
    buildEffortArgs: (effort) => ["--effort", effort],
  },
  codex: {
    command: "codex",
    baseArgs: ["--full-auto"],
    buildSessionArgs: (sessionId) => ["resume", sessionId],
    buildModelArgs: (model) => ["-m", model],
    buildEffortArgs: (effort) => ["-c", `model_reasoning_effort=\"${effort}\"`],
  },
  gemini: {
    command: "gemini",
    baseArgs: ["--yolo"],
    buildSessionArgs: (sessionId) => ["--resume", sessionId],
    buildModelArgs: (model) => ["--model", model],
  },
};

export function buildBridgeCommand(carrierId: string, cliType: CliType): string {
  const launch = LAUNCH_CONFIGS[cliType];
  const cliConfig = getModelConfig()[carrierId];
  const sessionId = getSessionId(carrierId);
  const args = [...launch.baseArgs];

  if (sessionId && launch.buildSessionArgs) {
    args.push(...launch.buildSessionArgs(sessionId));
  }

  if (cliConfig?.model && launch.buildModelArgs) {
    args.push(...launch.buildModelArgs(cliConfig.model));
  }

  if (cliConfig?.effort && launch.buildEffortArgs) {
    args.push(...launch.buildEffortArgs(cliConfig.effort));
  }

  return joinCommand(launch.command, args);
}

function joinCommand(command: string, args: string[]): string {
  return [shellQuote(command), ...args.map((arg) => shellQuote(arg))].join(" ");
}

function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
