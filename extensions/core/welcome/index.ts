/**
 * core-welcome — 웰컴 화면 확장
 *
 * 세션 시작 시 웰컴 오버레이(또는 헤더)를 표시하고,
 * 에이전트 활동 시작 시 자동으로 해제한다.
 *
 * globalThis["__pi_core_welcome__"]에 dismiss 함수를 노출하여
 * 다른 확장(infra-hud 등)에서도 디스미스를 트리거할 수 있다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { WELCOME_GLOBAL_KEY, type WelcomeBridge } from "./types.js";
import { readSettings } from "../hud/utils.js";
import { WelcomeComponent, WelcomeHeader, discoverLoadedCounts, getRecentSessions } from "./welcome.js";

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
}

// ═══════════════════════════════════════════════════════════════════════════
// 확장 진입점
// ═══════════════════════════════════════════════════════════════════════════

export default function welcome(pi: ExtensionAPI) {
  const state: WelcomeState = {
    dismissFn: null,
    headerActive: false,
    shouldDismiss: false,
  };

  // globalThis 브릿지 등록 — 다른 확장이 dismiss를 트리거할 수 있음
  (globalThis as any)[WELCOME_GLOBAL_KEY] = {
    dismiss: () => dismissWelcome(state as any, state),
  } satisfies WelcomeBridge;

  // ── 이벤트 핸들러 ──

  pi.on("session_start", async (event, ctx) => {
    // globalThis 브릿지 업데이트 (ctx 바인딩)
    (globalThis as any)[WELCOME_GLOBAL_KEY] = {
      dismiss: () => dismissWelcome(ctx, state),
    } satisfies WelcomeBridge;

    if (event.reason === "resume" || event.reason === "new") {
      dismissWelcome(ctx, state);
      return;
    }

    state.dismissFn = null;
    state.headerActive = false;
    state.shouldDismiss = false;

    if (!ctx.hasUI) return;

    const settings = readSettings();
    if (settings.quietStartup === true) {
      setupWelcomeHeader(ctx, state);
    } else {
      setupWelcomeOverlay(ctx, state);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    dismissWelcome(ctx, state);
  });

  pi.on("tool_call", async (_event, ctx) => {
    dismissWelcome(ctx, state);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// dismiss 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

function dismissWelcome(ctx: any, state: WelcomeState): void {
  if (state.dismissFn) {
    state.dismissFn();
    state.dismissFn = null;
  } else {
    state.shouldDismiss = true;
  }
  if (state.headerActive) {
    state.headerActive = false;
    ctx.ui.setHeader(undefined);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 웰컴 헤더 설정 (quietStartup 모드)
// ═══════════════════════════════════════════════════════════════════════════

function setupWelcomeHeader(ctx: any, state: WelcomeState): void {
  const modelName = ctx.model?.name || ctx.model?.id || "No model";
  const providerName = ctx.model?.provider || "Unknown";
  const loadedCounts = discoverLoadedCounts();
  const recentSessions = getRecentSessions(3);

  const header = new WelcomeHeader(modelName, providerName, recentSessions, loadedCounts);
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

  // pi 초기화 완료를 기다리는 짧은 지연
  setTimeout(() => {
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
        );

        let countdown = 30;
        let dismissed = false;

        const dismiss = () => {
          if (dismissed) return;
          dismissed = true;
          clearInterval(interval);
          state.dismissFn = null;
          done();
        };

        state.dismissFn = dismiss;

        // 외부 체크와 이 콜백 사이에 해제 요청이 들어왔을 수 있음
        if (state.shouldDismiss) {
          state.shouldDismiss = false;
          dismiss();
        }

        const interval = setInterval(() => {
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
            clearInterval(interval);
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
  }, 100);
}
