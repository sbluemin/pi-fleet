/**
 * core-welcome — 웰컴 화면 확장
 *
 * 세션 시작 시 웰컴 오버레이(또는 헤더)를 표시하고,
 * 에이전트 활동 시작 시 자동으로 해제한다.
 *
 * globalThis["__pi_core_welcome__"]에 dismiss 함수를 노출하여
 * 다른 확장(core-hud 등)에서도 디스미스를 트리거할 수 있다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { WELCOME_GLOBAL_KEY, type WelcomeBridge } from "./types.js";
import {
  WelcomeComponent,
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
  const state: WelcomeState = {
    dismissFn: null,
    headerActive: false,
    shouldDismiss: false,
    currentCtx: null,
  };

  (globalThis as any)[WELCOME_GLOBAL_KEY] = {
    dismiss: () => dismissWelcome(state.currentCtx, state),
  } satisfies WelcomeBridge;

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

function createFleetUpdatePrompt(fleetRoot: string): string {
  return [
    "Please update the pi-fleet repository.",
    "",
    `1. Move to the local repository at the absolute path \`${fleetRoot}\`.`,
    "2. Identify the current active branch and synchronize it with the remote latest state. Run fetch followed by pull as needed.",
    "3. Follow the update procedure described in the repository root `SETUP.md`. Do not skip any step it specifies (dependency installation, link refresh, build, verification, etc.).",
    "4. Report the actions taken and verification results concisely.",
  ].join("\n");
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

function setupWelcomeOverlay(ctx: any, state: WelcomeState): void {
  const modelName = ctx.model?.name || ctx.model?.id || "No model";
  const providerName = ctx.model?.provider || "Unknown";
  const loadedCounts = discoverLoadedCounts();
  const recentSessions = getRecentSessions(3);
  const gitUpdate = checkGitUpdateStatus();

  setTimeout(() => {
    try {
      if (state.shouldDismiss) {
        state.shouldDismiss = false;
        return;
      }

      const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = sessionEvents.some((e: any) =>
        (e.type === "message" && e.message?.role === "assistant") ||
        e.type === "tool_call" ||
        e.type === "tool_result"
      );
      if (hasActivity) {
        return;
      }

      ctx.ui.custom(
        (tui: any, _theme: any, _keybindings: any, done: (result: void) => void) => {
          const welcome = new WelcomeComponent(
            modelName,
            providerName,
            recentSessions,
            loadedCounts,
            gitUpdate,
          );

          let countdown = 30;
          let dismissed = false;
          let interval: ReturnType<typeof setInterval> | null = null;

          const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            if (interval) clearInterval(interval);
            state.dismissFn = null;
            done(undefined);
          };

          state.dismissFn = dismiss;

          interval = setInterval(() => {
            countdown -= 1;
            if (countdown <= 0) {
              dismiss();
              return;
            }
            welcome.setCountdown(countdown);
            tui.requestRender();
          }, 1000);

          return {
            render(width: number, height: number) {
              void height;
              return welcome.render(width);
            },
            input(key: any) {
              if (key?.name === "escape" || key === "q") {
                dismiss();
                return true;
              }
              if (key === "u") {
                dismiss();
                ctx.input(createFleetUpdatePrompt(FLEET_ROOT));
                return true;
              }
              return false;
            },
            destroy() {
              if (interval) clearInterval(interval);
            },
          };
        },
      );
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  }, 50);
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
