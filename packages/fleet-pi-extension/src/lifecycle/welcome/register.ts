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

import { WELCOME_GLOBAL_KEY, type WelcomeBridge } from "../../tui/welcome/types.js";
import {
  WelcomeComponent,
  WelcomeHeader,
  checkGitUpdateStatus,
  discoverLoadedCounts,
  getRecentSessions,
} from "../../tui/welcome/welcome.js";
import { isStaleExtensionContextError } from "../../tui/context-errors.js";

// ═══════════════════════════════════════════════════════════════════════════
// 내부 상태
// ═══════════════════════════════════════════════════════════════════════════

interface WelcomeState {
  /** 오버레이 dismiss 함수 (오버레이 활성 시 설정됨) */
  dismissFn: (() => void) | null;
  /** 헤더 모드 활성 여부 */
  headerActive: boolean;
  /** dismiss가 오버레이 설정 전에 요청되었는지 (race condition 방지) */
  shouldDismiss: boolean;
  /** 현재 세션 ctx. 세션 교체 중에는 null로 비워 stale ctx 접근을 피한다. */
  currentCtx: any | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = join(__dirname, "..", "..", "..");

// ═══════════════════════════════════════════════════════════════════════════
// 확장 진입점
// ═══════════════════════════════════════════════════════════════════════════

export default function welcome(pi: ExtensionAPI) {
  // 기본 PI 시작 출력 억제 — 첫 실행부터 적용되도록 확장 로드 시 즉시 설정
  ensureQuietStartup();
  const state: WelcomeState = {
    dismissFn: null,
    headerActive: false,
    shouldDismiss: false,
    currentCtx: null,
  };

  // globalThis 브릿지 등록 — 다른 확장이 dismiss를 트리거할 수 있음
  (globalThis as any)[WELCOME_GLOBAL_KEY] = {
    dismiss: () => dismissWelcome(state.currentCtx, state),
  } satisfies WelcomeBridge;

  // ── 이벤트 핸들러 ──

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

    // 터미널 화면 클리어 — 웰컴 헤더 전 깨끗한 캔버스 확보
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

    // 항상 헤더 모드로 렌더링
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

// ═══════════════════════════════════════════════════════════════════════════
// 업데이트 커맨드 프롬프트
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// dismiss 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// 웰컴 헤더 설정
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// 웰컴 오버레이 설정 (기본 시작 모드)
// ═══════════════════════════════════════════════════════════════════════════

function setupWelcomeOverlay(ctx: any, state: WelcomeState): void {
  const modelName = ctx.model?.name || ctx.model?.id || "No model";
  const providerName = ctx.model?.provider || "Unknown";
  const loadedCounts = discoverLoadedCounts();
  const recentSessions = getRecentSessions(3);
  const gitUpdate = checkGitUpdateStatus();

  // pi 초기화 완료를 기다리는 짧은 지연
  setTimeout(() => {
    try {
      // 이미 해제 요청됨이면 스킵
      if (state.shouldDismiss) {
        state.shouldDismiss = false;
        return;
      }

      // 세션에 이미 활동이 있으면 스킵 (p "command" 케이스)
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
            done();
          };

          state.dismissFn = dismiss;

          // 외부 체크와 이 콜백 사이에 해제 요청이 들어왔을 수 있음
          if (state.shouldDismiss) {
            state.shouldDismiss = false;
            dismiss();
          }

          interval = setInterval(() => {
            if (dismissed) return;
            countdown--;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) dismiss();
          }, 1000);

          return {
            focused: false,
            invalidate: () => welcome.invalidate(),
            render: (width: number) => welcome.render(width),
            handleInput: () => dismiss(),
            dispose: () => {
              dismissed = true;
              if (interval) clearInterval(interval);
            },
          };
        },
        {
          overlay: true,
          overlayOptions: () => ({
            verticalAlign: "center",
            horizontalAlign: "center",
          }),
        },
      ).catch(() => {});
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  }, 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// quietStartup 자동 활성화
// ═══════════════════════════════════════════════════════════════════════════

/**
 * settings.json에 quietStartup: true를 주입한다.
 * 확장 로드 시 즉시 실행하여 다음 pi 시작부터 기본 화면이 억제된다.
 * 이미 설정되어 있으면 파일 I/O를 굴리지 않는다.
 */
function ensureQuietStartup(): void {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const settingsPath = join(homeDir, ".pi", "agent", "settings.json");
  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
    if (settings.quietStartup === true) return; // 이미 설정됨
    settings.quietStartup = true;
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  } catch {
    // 파일 쓰기 실패 시 조용히 스킵 — pi 동작에는 영향 없음
  }
}
