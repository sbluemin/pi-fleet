/**
 * admiralty/register.ts — Admiralty 모드 와이어링
 *
 * before_agent_start에서 Admiralty 시스템 프롬프트를 전체 교체하고,
 * IPC 서버를 기동하며, 함대 관리 도구를 등록한다.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

import * as os from "node:os";
import * as path from "node:path";

import { PROVIDER_ID, setCliSystemPrompt } from "../../core/agentclientprotocol/provider-types.js";
import { setEditorBorderColor, setEditorRightLabel } from "../../core/hud/border-bridge.js";
import { getState } from "../index.js";
import { AdmiraltyServer } from "../ipc/server.js";
import { registerAdmiraltyHandlers } from "../ipc/methods.js";
import { buildAdmiraltySystemPrompt } from "../prompts.js";
import {
  GRAND_FLEET_ADMIRALTY_RUNTIME_KEY,
  type AdmiraltyPresenter,
  type AdmiraltyRuntimeState,
  type MissionReportParams,
} from "../types.js";
import { renderFleetEvent, renderReport } from "./report-renderer.js";
import { FleetRegistry } from "./fleet-registry.js";
import { initRosterWidget, disposeRosterWidget, syncRosterWidget } from "./roster-widget.js";
import { setAdmiraltyRuntime } from "./tools.js";

const GRAND_FLEET_HOME = path.join(os.homedir(), ".pi", "grand-fleet");
const DEFAULT_SOCKET_FILE = path.join(GRAND_FLEET_HOME, "admiralty.sock");

export default function registerAdmiralty(pi: ExtensionAPI): void {
  const runtime = ensureRuntime();
  getState().socketPath = runtime.socketPath;
  runtime.presenter = createPresenter(pi, runtime);

  // before_agent_start: 시스템 프롬프트 전체 교체
  pi.on("before_agent_start", () => {
    const roster = getRegistry().getRoster();
    const systemPrompt = buildAdmiraltySystemPrompt(roster);
    return { systemPrompt };
  });

  // session_start: IPC 서버 기동
  pi.on("session_start", async (_event, ctx) => {
    // Admiralty 모드 HUD 표시
    const ADMIRALTY_COLOR = "\x1b[38;2;255;200;60m";
    setEditorBorderColor(ADMIRALTY_COLOR);
    setEditorRightLabel(`${ADMIRALTY_COLOR}⚓ Admiralty\x1b[0m`);
    const state = getState();
    if (!state) return;

    state.socketPath = runtime.socketPath;

    try {
      await runtime.server.start();
      notify(ctx, `[Grand Fleet] Admiralty 서버 기동: ${runtime.socketPath}`, "info");
      syncAcpSystemPrompt(ctx);
      initRosterWidget(ctx);
      getRegistry().onChange(syncRosterWidget);
      syncRosterWidget();
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
    disposeRosterWidget();
    runtime.presenter = undefined;
    getRegistry().shutdown();
    await getServer().close();
    delete (globalThis as any)[GRAND_FLEET_ADMIRALTY_RUNTIME_KEY];
  });

  // 도구의 런타임 참조 주입 (도구 자체는 index.ts에서 이미 등록됨)
  setAdmiraltyRuntime(getRegistry, getServer);
}

export function getFleetRegistry(): FleetRegistry | null {
  return readRuntime()?.registry as FleetRegistry | null;
}

function getRegistry(): FleetRegistry {
  const runtime = readRuntime();
  if (!runtime) {
    throw new Error("Admiralty registry가 초기화되지 않았습니다.");
  }
  return runtime.registry as FleetRegistry;
}

function getServer(): AdmiraltyServer {
  const runtime = readRuntime();
  if (!runtime) {
    throw new Error("Admiralty server가 초기화되지 않았습니다.");
  }
  return runtime.server as AdmiraltyServer;
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

/**
 * ACP 프로바이더에 Admiralty 시스템 프롬프트를 주입한다.
 */
function syncAcpSystemPrompt(ctx: ExtensionContext): void {
  const isAcp = ctx.model?.provider === PROVIDER_ID;
  if (isAcp) {
    const roster = getRegistry().getRoster();
    setCliSystemPrompt(buildAdmiraltySystemPrompt(roster));
    return;
  }
  setCliSystemPrompt(null);
}

function ensureRuntime(): AdmiraltyRuntimeState {
  const existing = readRuntime();
  if (existing) {
    return existing;
  }

  const socketPath = process.env.PI_GRAND_FLEET_SOCK ?? DEFAULT_SOCKET_FILE;
  const registry = new FleetRegistry();
  const server = new AdmiraltyServer(socketPath);

  registerAdmiraltyHandlers(server, {
    onFleetRegister: async (params, socket) => {
      const result = await registry.register(params, socket);
      runtime.presenter?.onFleetConnected(String(params.fleetId ?? ""));
      return result;
    },
    onFleetDeregister: (params) => {
      const fleetId = String(params.fleetId ?? "");
      registry.deregister(fleetId);
      runtime.presenter?.onFleetDisconnected(fleetId);
    },
    onFleetHeartbeat: (params) => {
      registry.heartbeat(params);
    },
    onFleetStatus: (params) => {
      registry.updateStatus(params);
    },
    onMissionReport: (params) => {
      registry.handleReport(params);
      runtime.presenter?.onMissionReport(toMissionReportParams(params));
    },
  });
  server.onDisconnect((socket, reason) => {
    const fleetId = registry.deregisterBySocket(socket, reason);
    if (fleetId) {
      runtime.presenter?.onFleetDisconnected(fleetId);
    }
  });

  const runtime: AdmiraltyRuntimeState = {
    registry,
    server,
    socketPath,
  };
  (globalThis as any)[GRAND_FLEET_ADMIRALTY_RUNTIME_KEY] = runtime;
  return runtime;
}

function readRuntime(): AdmiraltyRuntimeState | null {
  return ((globalThis as any)[GRAND_FLEET_ADMIRALTY_RUNTIME_KEY] ?? null) as AdmiraltyRuntimeState | null;
}

function createPresenter(
  pi: ExtensionAPI,
  runtime: AdmiraltyRuntimeState,
): AdmiraltyPresenter {
  return {
    onFleetConnected(fleetId: string): void {
      renderFleetEvent(pi, fleetId, "connected", {
        designation: lookupDesignation(runtime, fleetId),
      });
    },
    onFleetDisconnected(fleetId: string): void {
      renderFleetEvent(pi, fleetId, "disconnected", {
        designation: lookupDesignation(runtime, fleetId),
      });
    },
    onMissionReport(params: MissionReportParams): void {
      renderReport(pi, params, {
        designation: lookupDesignation(runtime, params.fleetId),
      });
    },
  };
}

function lookupDesignation(
  runtime: AdmiraltyRuntimeState,
  fleetId: string,
): string | undefined {
  return runtime.registry.getConnectedFleet?.(fleetId)?.designation;
}

function toMissionReportParams(params: Record<string, unknown>): MissionReportParams {
  return params as unknown as MissionReportParams;
}
