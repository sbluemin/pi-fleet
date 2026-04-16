/**
 * admiralty/register.ts — Admiralty 모드 와이어링
 *
 * before_agent_start에서 시스템 프롬프트를 전체 교체하고,
 * IPC 서버를 기동하며, 함대 관리 도구를 등록한다.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

import { getState } from "../index.js";
import { AdmiraltyServer } from "../ipc/server.js";
import { registerAdmiraltyHandlers } from "../ipc/methods.js";
import { buildAdmiraltySystemPrompt } from "../prompts.js";
import { FleetRegistry } from "./fleet-registry.js";
import { setAdmiraltyRuntime } from "./tools.js";

const DEFAULT_SOCKET_FILE = ".grand-fleet/admiralty.sock";

let server: AdmiraltyServer | null = null;
let registry: FleetRegistry | null = null;

export default function registerAdmiralty(pi: ExtensionAPI): void {
  registry = new FleetRegistry();

  // before_agent_start: 시스템 프롬프트 전체 교체
  pi.on("before_agent_start", () => {
    const roster = getRegistry().getRoster();
    const systemPrompt = buildAdmiraltySystemPrompt(roster);
    return { systemPrompt };
  });

  // session_start: IPC 서버 기동
  pi.on("session_start", async (_event, ctx) => {
    const state = getState();
    if (!state) return;

    const socketPath = state.socketPath ?? `${process.cwd()}/${DEFAULT_SOCKET_FILE}`;
    state.socketPath = socketPath;

    server = new AdmiraltyServer(socketPath);

    registerAdmiraltyHandlers(server, {
      onFleetRegister: async (params, socket) => {
        return getRegistry().register(params, socket);
      },
      onFleetDeregister: (params, socket) => {
        void socket;
        getRegistry().deregister(params.fleetId as string);
      },
      onFleetHeartbeat: (params) => {
        getRegistry().heartbeat(params);
      },
      onFleetStatus: (params) => {
        getRegistry().updateStatus(params);
      },
      onMissionReport: (params, socket) => {
        void socket;
        // TODO: report-renderer로 전달
        getRegistry().handleReport(params);
      },
    });

    try {
      await server.start();
      notify(ctx, `[Grand Fleet] Admiralty 서버 기동: ${socketPath}`, "info");
    } catch (err) {
      notify(
        ctx,
        `[Grand Fleet] 서버 기동 실패: ${toErrorMessage(err)}`,
        "error",
      );
    }
  });

  // session_shutdown: 서버 종료
  pi.on("session_shutdown", async () => {
    await server?.close();
    server = null;
  });

  // 도구의 런타임 참조 주입 (도구 자체는 index.ts에서 이미 등록됨)
  setAdmiraltyRuntime(getRegistry, getServer);
}

function getRegistry(): FleetRegistry {
  if (!registry) {
    throw new Error("Admiralty registry가 초기화되지 않았습니다.");
  }
  return registry;
}

function getServer(): AdmiraltyServer {
  if (!server) {
    throw new Error("Admiralty server가 초기화되지 않았습니다.");
  }
  return server;
}

function notify(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "error",
): void {
  ctx.ui.notify(message, level);
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
