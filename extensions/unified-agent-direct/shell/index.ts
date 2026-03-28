/**
 * unified-agent-direct — 에이전트 팝업 명령어 빌더
 *
 * 현재 활성 CLI의 sessionId로 resume하거나,
 * 세션이 없으면 신규 인터랙티브 모드로 실행합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import { loadSelectedModels } from "../model-selection/store.js";

/** CLI 명령어 매핑 (CliConfigs.ts의 cliCommand 값) */
const CLI_COMMANDS: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

export interface PopupCommandOptions {
  agentId: CliType;
  /** 현재 활성 CLI 세션 ID (있으면 resume) */
  sessionId?: string;
}

/**
 * 현재 저장된 모델/추론 설정과 세션 ID를 반영해 에이전트 네이티브 팝업 명령어를 조립합니다.
 *
 * - sessionId가 있으면 해당 세션을 resume
 * - sessionId가 없으면 신규 인터랙티브 실행
 *
 * Resume 인자 형식:
 *   claude: claude --resume <sessionId> [opts]
 *   codex:  codex resume <sessionId> [opts]
 *   gemini: gemini --resume <sessionId> [opts]
 */
export function buildAgentPopupCommand(
  opts: PopupCommandOptions,
  _ctx: ExtensionContext,
  configDir: string,
): string {
  const { agentId, sessionId } = opts;
  const cliConfig = loadSelectedModels(configDir)[agentId];
  const command = CLI_COMMANDS[agentId] ?? agentId;
  const model = cliConfig?.model;
  const effort = cliConfig?.effort;
  const args = buildResumeOrNewArgs(agentId, sessionId, model, effort);
  return joinCommand(command, args);
}

/**
 * CLI별 resume 인자 또는 신규 실행 인자를 조립합니다.
 */
function buildResumeOrNewArgs(
  cli: CliType,
  sessionId: string | undefined,
  model: string | undefined,
  effort: string | undefined,
): string[] {
  const args: string[] = [];

  // 기본 권한 우회 옵션
  if (cli === "claude") {
    args.push("--dangerously-skip-permissions");
  } else if (cli === "codex") {
    args.push("--full-auto");
  } else if (cli === "gemini") {
    args.push("--yolo");
  }

  // Resume 인자 (CLI별 형식이 다름)
  if (sessionId) {
    switch (cli) {
      case "claude":
        // claude --resume <sessionId>
        args.push("--resume", sessionId);
        break;
      case "codex":
        // codex resume <sessionId>
        args.push("resume", sessionId);
        break;
      case "gemini":
        // gemini --resume <sessionId>
        args.push("--resume", sessionId);
        break;
    }
  }

  // 모델 인자
  if (model) {
    if (cli === "codex") {
      args.push("-m", model);
    } else {
      args.push("--model", model);
    }
  }

  // Effort / reasoning 인자
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
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
