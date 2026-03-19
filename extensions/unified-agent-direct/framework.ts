/**
 * unified-agent-direct — 다이렉트 모드 프레임워크
 *
 * 외부 확장이 import하여 커스텀 다이렉트 모드를 등록하는 공개 API입니다.
 *
 * ⚠️ pi는 각 확장을 별도 번들로 로드하므로 모듈 레벨 변수는
 *    확장 간에 공유되지 않습니다. globalThis를 통해 상태를 공유합니다.
 *
 * 프레임워크가 자동 관리하는 것:
 *  - 모드 상태 관리 (globalThis 공유 Map + activeModeId)
 *  - 상호 배타 (활성화 시 다른 모든 모드 자동 비활성화)
 *  - 에이전트 패널 연동 (활성 모드에 따라 독점/3분할 뷰 전환 + 프레임 색상)
 *  - 입력 인터셉트 (1회만 등록, activeModeId로 라우팅)
 *  - 가드 체크 (active? → busy? → empty? → slash? → onExecute)
 *  - 메시지 출력 ({id}-user → onExecute → {id}-response)
 *  - 렌더러 등록 (커스텀 or 기본)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { setAgentPanelMode, hideAgentPanel } from "./agent-panel";
import { createDefaultUserRenderer, createDefaultResponseRenderer } from "./render/message-renderers";

// ─── 공개 타입 ───────────────────────────────────────────

export interface DirectModeConfig {
  /** 고유 식별자 → 메시지 `{id}-user/{id}-response` */
  id: string;
  /** 표시 이름 */
  displayName: string;
  /** 토글 단축키 */
  shortcutKey: string;
  /** 에이전트 패널 프레임 색상 (ANSI) */
  color: string;
  /** 응답 배경색 (ANSI, 선택) */
  bgColor?: string;
  /**
   * 실행 핸들러 — 사용자 입력 시 호출
   * 반환 결과가 `{id}-response` 메시지로 자동 출력됨
   */
  onExecute: (
    request: string,
    ctx: ExtensionContext,
    helpers: DirectModeHelpers,
  ) => Promise<DirectModeResult>;
  /** @deprecated 에이전트 패널로 통합되어 더 이상 사용되지 않음 */
  useDefaultAnimation?: boolean;
  /** 커스텀 응답 렌더러 (없으면 기본 렌더러) */
  renderResponse?: (...args: any[]) => any;
  /** 커스텀 사용자 입력 렌더러 (없으면 기본 렌더러) */
  renderUser?: (...args: any[]) => any;
  /** 에이전트 패널 하단 힌트 커스터마이즈 */
  bottomHint?: string;
}

export interface DirectModeHelpers {
  /** 메시지 전송 (pi.sendMessage 래핑) */
  sendMessage: (msg: any, opts?: any) => void;
  /** 현재 direct 실행 취소 시그널 */
  signal: AbortSignal;
}

export interface DirectModeResult {
  /** 응답 본문 */
  content: string;
  /** 추가 메타데이터 (렌더러에 전달) */
  details?: Record<string, unknown>;
}

// ─── globalThis 공유 상태 ────────────────────────────────

const FRAMEWORK_KEY = "__pi_direct_mode_framework__";

interface ModeState {
  config: DirectModeConfig;
  active: boolean;
  busy: boolean;
  abortController: AbortController | null;
  /** 이 모드를 등록한 pi 인스턴스 (메시지 전송에 사용) */
  pi: ExtensionAPI;
}

interface FrameworkState {
  /** 등록된 모든 모드 */
  modes: Map<string, ModeState>;
  /** 현재 활성 모드 ID (null = 기본 모드) */
  activeModeId: string | null;
  /** 입력 핸들러 등록 여부 (글로벌에서 1회만) */
  inputRegistered: boolean;
  /** direct 취소 단축키 등록 여부 */
  cancelShortcutRegistered: boolean;
  /** 상태바 갱신 콜백 */
  statusUpdateCallbacks: Array<() => void>;
}

/** globalThis 기반 공유 상태를 반환합니다. */
function getState(): FrameworkState {
  let s = (globalThis as any)[FRAMEWORK_KEY] as FrameworkState | undefined;
  if (!s) {
    s = {
      modes: new Map(),
      activeModeId: null,
      inputRegistered: false,
      cancelShortcutRegistered: false,
      statusUpdateCallbacks: [],
    };
    (globalThis as any)[FRAMEWORK_KEY] = s;
  }
  return s;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────

/** 모든 모드를 비활성화합니다. (패널은 활성화 코드에서 관리) */
function deactivateAll(_ctx: ExtensionContext) {
  const gs = getState();
  for (const [_id, state] of gs.modes) {
    state.active = false;
  }
  gs.activeModeId = null;
}

/** 지정 모드를 제외하고 아직 busy인 모드를 하나 반환합니다. */
function findNextBusyMode(excludeId: string): ModeState | null {
  const gs = getState();
  for (const [id, state] of gs.modes) {
    if (id !== excludeId && state.busy) return state;
  }
  return null;
}

// ─── 공개 API ────────────────────────────────────────────

/**
 * 커스텀 다이렉트 모드를 등록합니다.
 *
 * 프레임워크가 자동으로:
 *  - 단축키 토글 등록
 *  - 상호 배타적 모드 전환 (globalThis 공유)
 *  - 에이전트 패널 모드 설정 + 표시/숨김
 *  - 입력 인터셉트 (글로벌 1회만 등록)
 *  - 메시지 렌더러 등록
 */
export function registerCustomDirectMode(
  pi: ExtensionAPI,
  config: DirectModeConfig,
): void {
  const gs = getState();

  // 모드 상태 등록
  const state: ModeState = { config, active: false, busy: false, abortController: null, pi };
  gs.modes.set(config.id, state);

  // ── 단축키 등록 ──
  pi.registerShortcut(config.shortcutKey, {
    description: `${config.displayName} 다이렉트 모드 토글`,
    handler: async (ctx) => {
      if (state.active) {
        // 같은 키 재입력 → 비활성화 (busy 중이어도 허용 — 실행은 백그라운드에서 완료됨)
        state.active = false;
        gs.activeModeId = null;
        setAgentPanelMode(ctx, null);
        hideAgentPanel(ctx);
        notifyStatusUpdate();
      } else {
        // 다른 모든 모드 비활성화
        deactivateAll(ctx);
        // 이 모드 활성화
        state.active = true;
        gs.activeModeId = config.id;
        // 에이전트 패널에 모드 설정 (패널 자동 펼침 없음 — alt+p로만 열림)
        const hint = config.bottomHint ?? ` ${config.shortcutKey} to exit `;
        setAgentPanelMode(ctx, config.id, { bottomHint: hint });
        notifyStatusUpdate();
      }
    },
  });

  if (!gs.cancelShortcutRegistered) {
    gs.cancelShortcutRegistered = true;
    pi.registerShortcut("alt+x", {
      description: "활성 다이렉트 모드 실행 취소",
      handler: async (ctx) => {
        const activeModeId = getState().activeModeId;
        if (!activeModeId) return;

        const activeState = getState().modes.get(activeModeId);
        if (!activeState?.busy || !activeState.abortController) return;

        activeState.abortController.abort();
        ctx.ui.notify(`${activeState.config.displayName} 요청/연결 종료 중...`, "info");
      },
    });
  }

  // ── 메시지 렌더러 등록 ──
  const userRenderer = config.renderUser ?? createDefaultUserRenderer(config);
  pi.registerMessageRenderer(`${config.id}-user`, userRenderer);

  const responseRenderer = config.renderResponse ?? createDefaultResponseRenderer(config);
  pi.registerMessageRenderer(`${config.id}-response`, responseRenderer);

  // ── 입력 핸들러 등록 (글로벌에서 1회만) ──
  if (!gs.inputRegistered) {
    gs.inputRegistered = true;
    registerInputHandler(pi);
  }
}

/**
 * 특정 모드를 프로그래밍적으로 활성화합니다.
 */
export function activateMode(ctx: ExtensionContext, modeId: string): boolean {
  const gs = getState();
  const state = gs.modes.get(modeId);
  if (!state) return false;
  // busy여도 전환(활성화)은 허용 — 단축키 핸들러와 동일 정책

  deactivateAll(ctx);
  state.active = true;
  gs.activeModeId = modeId;

  const hint = state.config.bottomHint ?? ` ${state.config.shortcutKey} to exit `;
  setAgentPanelMode(ctx, modeId, { bottomHint: hint });
  // 패널 자동 펼침 없음 — alt+p로만 열림
  notifyStatusUpdate();
  return true;
}

/**
 * 특정 모드를 프로그래밍적으로 비활성화합니다.
 */
export function deactivateMode(ctx: ExtensionContext, modeId: string): void {
  const gs = getState();
  const state = gs.modes.get(modeId);
  if (state?.active) {
    state.active = false;
    if (gs.activeModeId === modeId) {
      gs.activeModeId = null;
      setAgentPanelMode(ctx, null);
      hideAgentPanel(ctx);
      notifyStatusUpdate();
    }
  }
}

/**
 * 현재 활성 모드 ID를 반환합니다. (없으면 null)
 */
export function getActiveModeId(): string | null {
  return getState().activeModeId;
}

/**
 * 상태바 갱신 콜백을 등록합니다.
 */
export function onStatusUpdate(callback: () => void): void {
  const gs = getState();
  gs.statusUpdateCallbacks.push(callback);
}

/**
 * 등록된 모든 상태바 갱신 콜백을 호출합니다.
 */
export function notifyStatusUpdate(): void {
  const gs = getState();
  for (const cb of gs.statusUpdateCallbacks) {
    try { cb(); } catch { /* 무시 */ }
  }
}

// ─── 입력 핸들러 (글로벌 1회만 등록) ─────────────────────

/** 다이렉트 모드 실행 (fire-and-forget으로 호출됨) */
async function executeDirectMode(
  state: ModeState,
  ctx: ExtensionContext,
  request: string,
) {
  const { config } = state;
  const modePi = state.pi;
  const abortController = new AbortController();

  // 세션 이름 자동 설정
  if (!modePi.getSessionName()) {
    const preview = request.length > 50 ? request.slice(0, 50) + "…" : request;
    modePi.setSessionName(`${config.displayName}: ${preview}`);
  }

  // 사용자 입력 메시지 전송
  modePi.sendMessage({
    customType: `${config.id}-user`,
    content: request,
    display: true,
    details: { cli: config.id },
  });

  ctx.ui.setWorkingMessage(`${config.displayName} is processing...`);
  state.abortController = abortController;

  try {
    const helpers: DirectModeHelpers = {
      sendMessage: (msg, opts) => modePi.sendMessage(msg, opts),
      signal: abortController.signal,
    };

    const result = await config.onExecute(request, ctx, helpers);

    modePi.sendMessage({
      customType: `${config.id}-response`,
      content: result.content || "(no output)",
      display: true,
      details: result.details ?? { cli: config.id },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    modePi.sendMessage({
      customType: `${config.id}-response`,
      content: `Error: ${errMsg}`,
      display: true,
      details: { cli: config.id, error: true },
    });
  } finally {
    if (state.abortController === abortController) {
      state.abortController = null;
    }
    state.busy = false;
    // 다른 에이전트가 아직 처리 중이면 해당 메시지로 교체
    const nextBusy = findNextBusyMode(config.id);
    if (nextBusy) {
      ctx.ui.setWorkingMessage(`${nextBusy.config.displayName} is processing...`);
    } else {
      ctx.ui.setWorkingMessage();
    }
  }
}

function registerInputHandler(pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    const gs = getState();

    // 활성 모드가 없으면 패스
    if (!gs.activeModeId) return { action: "continue" as const };

    const state = gs.modes.get(gs.activeModeId);
    if (!state || !state.active) return { action: "continue" as const };

    // busy 가드 — 같은 에이전트에 순차 처리
    if (state.busy) {
      ctx.ui.notify("에이전트 응답 중입니다. 잠시 후 시도하세요.", "warning");
      return { action: "handled" as const };
    }

    const request = event.text?.trim();
    if (!request) return { action: "continue" as const };

    // 슬래시 명령어는 기본 처리로 전달
    if (request.startsWith("/")) return { action: "continue" as const };

    // busy 설정 후 즉시 handled 반환 — 실행은 백그라운드에서 진행
    state.busy = true;
    executeDirectMode(state, ctx, request).catch((e) => {
      console.error(`[unified-agent-direct] executeDirectMode 미처리 에러:`, e);
    });

    return { action: "handled" as const };
  });
}
