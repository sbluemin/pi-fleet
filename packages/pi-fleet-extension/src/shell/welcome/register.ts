/**
 * core-welcome — 웰컴 화면 확장
 *
 * 세션 시작 시 웰컴 오버레이(또는 헤더)를 표시하고,
 * 에이전트 활동 시작 시 자동으로 해제한다.
 *
 * welcome bridge에 dismiss 함수를 노출하여 다른 shell UI에서도 디스미스를 트리거할 수 있다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { setWelcomeBridge, type WelcomeBridge } from "./types.js";
import {
  WelcomeHeader,
  checkGitUpdateStatus,
  discoverLoadedCounts,
  getRecentSessions,
} from "./welcome.js";
import { isStaleExtensionContextError } from "../context-errors.js";

interface WelcomeState {
  dismissFn: (() => void) | null;
  headerActive: boolean;
  shouldDismiss: boolean;
  currentCtx: any | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = join(__dirname, "..", "..", "..");

export default function welcome(pi: ExtensionAPI) {
  ensureQuietStartup();
  registerWelcomeUpdateCommand(pi);

  const state: WelcomeState = {
    dismissFn: null,
    headerActive: false,
    shouldDismiss: false,
    currentCtx: null,
  };

  setWelcomeBridge({
    dismiss: () => dismissWelcome(state.currentCtx, state),
  } satisfies WelcomeBridge);

  pi.on("session_start", async (event, ctx) => {
    state.currentCtx = ctx;

    if (event.reason === "resume" || event.reason === "new") {
      dismissWelcome(ctx, state);
      return;
    }

    state.dismissFn = null;
    state.headerActive = false;
    state.shouldDismiss = false;

    if (!ctx.hasUI) return;

    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    setupWelcomeHeader(ctx, state);
  });

  pi.on("session_shutdown", async () => {
    state.dismissFn = null;
    state.headerActive = false;
    state.shouldDismiss = false;
    state.currentCtx = null;
  });

  pi.on("agent_start", async (_event, ctx) => {
    dismissWelcome(ctx, state);
  });

  pi.on("tool_call", async (_event, ctx) => {
    dismissWelcome(ctx, state);
  });
}

function dismissWelcome(ctx: any, state: WelcomeState): void {
  if (state.dismissFn) {
    try {
      state.dismissFn();
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
    state.dismissFn = null;
  } else {
    state.shouldDismiss = true;
  }
  if (state.headerActive) {
    state.headerActive = false;
    clearWelcomeHeader(ctx);
  }
}

function clearWelcomeHeader(ctx: any): void {
  if (!ctx?.ui?.setHeader) return;
  try {
    ctx.ui.setHeader(undefined);
  } catch (error) {
    if (!isStaleExtensionContextError(error)) throw error;
  }
}

function setupWelcomeHeader(ctx: any, state: WelcomeState): void {
  const modelName = ctx.model?.name || ctx.model?.id || "No model";
  const providerName = ctx.model?.provider || "Unknown";
  const loadedCounts = discoverLoadedCounts();
  const recentSessions = getRecentSessions(3);
  const gitUpdate = checkGitUpdateStatus();

  const header = new WelcomeHeader(modelName, providerName, recentSessions, loadedCounts, gitUpdate);
  state.headerActive = true;

  ctx.ui.setHeader(() => {
    return {
      render(width: number): string[] {
        return header.render(width);
      },
      invalidate() {
        header.invalidate();
      },
    };
  });
}

function ensureQuietStartup(): void {
  const quietMarker = join(FLEET_ROOT, ".pi", "quiet-startup.json");
  if (!existsSync(dirname(quietMarker))) {
    mkdirSync(dirname(quietMarker), { recursive: true });
  }

  let shouldWrite = true;
  if (existsSync(quietMarker)) {
    try {
      const current = JSON.parse(readFileSync(quietMarker, "utf8"));
      shouldWrite = current?.quietStartup !== true;
    } catch {
      shouldWrite = true;
    }
  }

  if (!shouldWrite) return;
  writeFileSync(quietMarker, JSON.stringify({ quietStartup: true }, null, 2));
}

function registerWelcomeUpdateCommand(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:update", {
    description: "pi-fleet 저장소를 원격 최신 상태로 업데이트",
    handler: async (_args, ctx) => {
      pi.sendUserMessage(createFleetUpdatePrompt(FLEET_ROOT));
      ctx.ui.notify("pi-fleet 업데이트 작업을 AI에게 전달했습니다.", "info");
    },
  });
}

function createFleetUpdatePrompt(fleetRoot: string): string {
  return [
    "Please update the pi-fleet repository.",
    "",
    `1. Move to the local repository at the absolute path \`${fleetRoot}\`.`,
    "2. Identify the current active branch and synchronize it with the remote latest state. Run fetch followed by pull as needed.",
    "3. Follow the update procedure described in the repository root \`SETUP.md\`. Do not skip any step it specifies (dependency installation, link refresh, build, verification, etc.).",
    "4. Report the actions taken and verification results concisely.",
  ].join("\n");
}
