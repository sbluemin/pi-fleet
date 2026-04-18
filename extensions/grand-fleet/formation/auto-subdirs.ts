/**
 * formation/auto-subdirs.ts — auto-subdirs Formation Strategy
 *
 * /fleet:grand-fleet:start 커맨드를 구현한다.
 * CWD 하위 1-depth 디렉토리를 스캔하여 tmux 세션을 생성하고
 * 각 디렉토리에 Fleet PI를 기동한다.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";

import { getLogAPI } from "../../core/log/bridge.js";
import { getState } from "../index.js";
import { GRAND_FLEET_STATE_KEY, type GrandFleetState, type FleetEntry } from "../types.js";
import { AdmiraltyServer } from "../ipc/server.js";
import { registerAdmiraltyHandlers } from "../ipc/methods.js";
import { FleetRegistry } from "../admiralty/fleet-registry.js";
import { setAdmiraltyRuntime } from "../admiralty/tools.js";
import { renderReport, renderFleetEvent } from "../admiralty/report-renderer.js";
import { buildAdmiraltySystemPrompt } from "../prompts.js";
import { addFleetEntry, loadConfig, saveConfig } from "./config.js";
import { scanSubdirectories } from "./scanner.js";
import * as tmux from "./tmux.js";

const LOG_SOURCE = "grand-fleet:formation";
const SESSION_PREFIX = "grand-fleet";
const GRAND_FLEET_HOME = path.join(os.homedir(), ".pi", "grand-fleet");
const ADMIRALTY_SOCKET_FILE = "admiralty.sock";

/** Fleet PI 기동 셸 커맨드를 생성한다. cd 후 env로 환경변수를 설정하고 pi를 실행. */
function buildFleetCommand(fleetId: string, socketPath: string, directory: string): string {
  return `cd ${directory} && env PI_GRAND_FLEET_ROLE=fleet PI_FLEET_ID=${fleetId} PI_GRAND_FLEET_SOCK=${socketPath} pi`;
}

/** 대함대 기동 */
export async function launchGrandFleet(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  void pi;

  const cwd = process.cwd();
  const log = getLogAPI();
  log.info(LOG_SOURCE, `대함대 기동 시작: ${cwd}`);
  const state = getState();

  const tmuxOk = await tmux.checkTmuxAvailable();
  if (!tmuxOk) {
    log.error(LOG_SOURCE, "tmux가 설치되어 있지 않습니다.");
    ctx.ui.notify(
      "tmux가 설치되어 있지 않습니다. brew install tmux로 설치해주세요.",
      "error",
    );
    return;
  }

  const config = loadConfig(cwd);
  const candidates = scanSubdirectories(cwd, config.formation.excludePatterns);

  if (candidates.length === 0) {
    log.warn(LOG_SOURCE, "함대 후보 디렉토리가 없습니다.");
    ctx.ui.notify(
      "함대 후보 디렉토리가 없습니다. CWD 하위에 프로젝트 디렉토리가 있는지 확인해주세요.",
      "error",
    );
    return;
  }

  const socketPath = path.join(GRAND_FLEET_HOME, ADMIRALTY_SOCKET_FILE);

  // Admiralty 상태 초기화 (환경변수 없이 시작된 경우)
  ensureAdmiraltyState(socketPath);

  // Admiralty IPC 서버 기동 — Fleet PI보다 먼저 시작해야 함
  try {
    await startAdmiraltyServer(pi, socketPath, ctx);
    log.info(LOG_SOURCE, `Admiralty IPC 서버 기동: ${socketPath}`);
  } catch (err) {
    log.error(LOG_SOURCE, `Admiralty 서버 기동 실패: ${toErrorMessage(err)}`);
    ctx.ui.notify(`Admiralty 서버 기동 실패: ${toErrorMessage(err)}`, "error");
    return;
  }

  const insideTmux = tmux.isInsideTmux();
  const mode = insideTmux ? "현재 세션" : "새 세션";
  log.info(LOG_SOURCE, `tmux 내부 실행 감지: ${insideTmux} — ${mode}`);

  if (insideTmux) {
    // 현재 tmux 세션에 윈도우 추가로 함대 기동
    await launchInCurrentSession(ctx, candidates, socketPath, config);
  } else {
    // tmux 외부 — 별도 세션 생성 + 윈도우 기반
    await launchWithSession(ctx, candidates, socketPath, config);
  }

  saveConfig(cwd, config);

  log.info(LOG_SOURCE, `대함대 기동 완료: ${candidates.length}개 함대 (${mode})`);
  ctx.ui.notify(
    `Grand Fleet 기동 완료 — ${candidates.length}개 함대 (${mode})`,
    "info",
  );
}

/** 대함대 철수 */
export async function shutdownGrandFleet(
  ctx: ExtensionContext,
): Promise<void> {
  getLogAPI().info(LOG_SOURCE, "대함대 철수");
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const sessionId = config.admiralty.sessionId;

  if (sessionId) {
    await tmux.killSession(sessionId);
  }

  config.fleets = [];
  config.admiralty = {};
  saveConfig(cwd, config);

  ctx.ui.notify("Grand Fleet 철수 완료", "info");
}

/** slash command 등록 */
export function registerFormationCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:grand-fleet:start", {
    description:
      "대함대 기동 — CWD 하위 디렉토리를 스캔하여 Fleet PI를 자동 기동",
    handler: async (_args, ctx) => {
      await launchGrandFleet(pi, ctx);
    },
  });

  pi.registerCommand("fleet:grand-fleet:stop", {
    description: "대함대 철수 — 모든 Fleet PI 종료 및 tmux 세션 정리",
    handler: async (_args, ctx) => {
      await shutdownGrandFleet(ctx);
    },
  });
}

/** 현재 tmux 세션에 윈도우 추가로 기동 */
async function launchInCurrentSession(
  ctx: ExtensionContext,
  candidates: Array<{ id: string; directory: string }>,
  socketPath: string,
  config: import("../types.js").GrandFleetConfig,
): Promise<void> {
  const sessionName = await tmux.getCurrentSessionName();

  // 현재 윈도우를 Admiralty로 이름 변경 + Grand Fleet 테마 적용
  await tmux.disableAutoRename();
  await tmux.renameCurrentWindow("Admiralty");
  await tmux.applyGrandFleetTheme(candidates.length);

  for (const candidate of candidates) {
    const piCommand = buildFleetCommand(candidate.id, socketPath, candidate.directory);
    getLogAPI().debug(LOG_SOURCE, `Fleet ${candidate.id} 기동: ${piCommand}`);

    try {
      await tmux.createWindowInCurrentSession(candidate.id, piCommand);
    } catch (err) {
      getLogAPI().error(
        LOG_SOURCE,
        `Fleet ${candidate.id} 기동 실패: ${toErrorMessage(err)}`,
      );
      ctx.ui.notify(`Fleet ${candidate.id} 기동 실패: ${toErrorMessage(err)}`, "error");
      continue;
    }

    const entry: FleetEntry = {
      id: candidate.id,
      directory: candidate.directory,
      status: "active",
      sessionId: sessionName,
    };
    addFleetEntry(config, entry);
  }

  config.admiralty = { socketPath, sessionId: sessionName };
}

/** 별도 세션 기동 — tmux 외부에서 실행 */
async function launchWithSession(
  ctx: ExtensionContext,
  candidates: Array<{ id: string; directory: string }>,
  socketPath: string,
  config: import("../types.js").GrandFleetConfig,
): Promise<void> {
  const sessionName = generateSessionName();

  try {
    await tmux.createSession(sessionName);
    await tmux.applyGrandFleetTheme(candidates.length);
  } catch (err) {
    ctx.ui.notify(`tmux 세션 생성 실패: ${toErrorMessage(err)}`, "error");
    return;
  }

  for (const candidate of candidates) {
    const piCommand = buildFleetCommand(candidate.id, socketPath, candidate.directory);
    getLogAPI().debug(LOG_SOURCE, `Fleet ${candidate.id} 기동: ${piCommand}`);

    try {
      await tmux.createWindow(sessionName, candidate.id);
      await tmux.sendCommand(sessionName, candidate.id, piCommand);
    } catch (err) {
      getLogAPI().error(
        LOG_SOURCE,
        `Fleet ${candidate.id} 기동 실패: ${toErrorMessage(err)}`,
      );
      ctx.ui.notify(`Fleet ${candidate.id} 기동 실패: ${toErrorMessage(err)}`, "error");
      continue;
    }

    const entry: FleetEntry = {
      id: candidate.id,
      directory: candidate.directory,
      status: "active",
      sessionId: sessionName,
    };
    addFleetEntry(config, entry);
  }

  config.admiralty = { socketPath, sessionId: sessionName };
}

/** 세션명을 생성한다. */
function generateSessionName(): string {
  return `${SESSION_PREFIX}-${Date.now()}`;
}

/** globalThis에 Admiralty 상태를 초기화한다 (환경변수 없이 시작된 경우). */
function ensureAdmiraltyState(socketPath: string): void {
  if ((globalThis as any)[GRAND_FLEET_STATE_KEY]) return;
  (globalThis as any)[GRAND_FLEET_STATE_KEY] = {
    role: "admiralty",
    fleetId: null,
    socketPath,
    connectedFleets: new Map(),
    totalCost: 0,
    activeMissionId: null,
  } satisfies GrandFleetState;
}

let admiraltyServer: AdmiraltyServer | null = null;
let admiraltyRegistry: FleetRegistry | null = null;

/** Admiralty IPC 서버를 기동하고 메서드 핸들러를 등록한다. */
async function startAdmiraltyServer(
  pi: ExtensionAPI,
  socketPath: string,
  ctx: ExtensionContext,
): Promise<void> {
  if (admiraltyServer) return; // 이미 기동됨

  admiraltyRegistry = new FleetRegistry();
  admiraltyServer = new AdmiraltyServer(socketPath);

  registerAdmiraltyHandlers(admiraltyServer, {
    onFleetRegister: async (params, socket) => {
      const result = await admiraltyRegistry!.register(params, socket);
      renderFleetEvent(pi, params.fleetId as string, "connected");
      return result;
    },
    onFleetDeregister: (params, socket) => {
      void socket;
      admiraltyRegistry!.deregister(params.fleetId as string);
      renderFleetEvent(pi, params.fleetId as string, "disconnected");
    },
    onFleetHeartbeat: (params) => {
      admiraltyRegistry!.heartbeat(params);
    },
    onFleetStatus: (params) => {
      admiraltyRegistry!.updateStatus(params);
    },
    onMissionReport: (params, socket) => {
      void socket;
      admiraltyRegistry!.handleReport(params);
      renderReport(pi, params);
    },
  });

  await admiraltyServer.start();

  // 도구의 런타임 참조 주입 (도구 자체는 index.ts에서 이미 등록됨)
  setAdmiraltyRuntime(
    () => admiraltyRegistry!,
    () => admiraltyServer!,
  );

  // before_agent_start 훅 등록 — 다음 턴부터 Admiralty 프롬프트 활성화
  pi.on("before_agent_start", () => {
    const roster = admiraltyRegistry!.getRoster();
    return { systemPrompt: buildAdmiraltySystemPrompt(roster) };
  });

  // session_shutdown 시 서버 정리
  pi.on("session_shutdown", async () => {
    await admiraltyServer?.close();
    admiraltyServer = null;
    admiraltyRegistry = null;
  });
}

/** 알 수 없는 오류를 사용자 메시지로 변환한다. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}
