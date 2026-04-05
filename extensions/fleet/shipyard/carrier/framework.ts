/**
 * fleet/carrier/framework.ts — Carrier 프레임워크
 *
 * 외부 확장(feature, experimentals 등)이 커스텀 Carrier를
 * 등록·활성화·비활성화하는 데 사용하는 공개 SDK입니다.
 *
 * ⚠️ pi는 각 확장을 별도 번들로 로드하므로 모듈 레벨 변수는
 *    확장 간에 공유되지 않습니다. globalThis를 통해 상태를 공유합니다.
 *
 * 프레임워크가 자동 관리하는 것:
 *  - Carrier 상태 관리 (globalThis 공유 Map + activeModeId)
 *  - 상호 배타 (활성화 시 다른 모든 carrier 자동 비활성화)
 *  - 에이전트 패널 연동 (활성 carrier에 따라 패널 모드 전환 + 프레임 색상)
 *  - 입력 인터셉트 (1회만 등록, activeModeId로 라우팅)
 *  - 가드 체크 (active? → busy? → empty? → slash? → onExecute)
 *  - 메시지 출력 ({id}-user → onExecute → {id}-response)
 *  - 렌더러 등록 (커스텀 or 기본)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import {
  CLI_DISPLAY_NAMES,
  CARRIER_COLORS,
  CARRIER_BG_COLORS,
  PANEL_EXCLUSIVE_HINT,
} from "../../constants.js";
import {
  setAgentPanelMode,
  hideAgentPanel,
} from "../../panel/lifecycle.js";
import {
  createDefaultUserRenderer,
  createDefaultResponseRenderer,
} from "../../render/message-renderers.js";
import { getKeybindAPI } from "../../../core/keybind/bridge.js";

import type {
  CarrierConfig,
  CarrierHelpers,
  CarrierResult,
  CarrierState,
  CarrierFrameworkState,
} from "./types.js";
import { CARRIER_FRAMEWORK_KEY } from "./types.js";

// 공개 타입 re-export — consumer가 fleet/index.ts를 통해 접근
export type { CarrierConfig, CarrierHelpers, CarrierResult };

// ─── 상수 ─────────────────────────────────────────────────

const DEFAULT_CARRIER_RGB: [number, number, number] = [180, 160, 220];
const CARRIER_RGBS: Record<string, [number, number, number]> = {
  claude: [255, 149, 0],
  codex: [169, 169, 169],
  gemini: [66, 133, 244],
};

/** CliType 표시 우선순위: claude → codex → gemini */
const CLI_TYPE_DISPLAY_ORDER: Record<string, number> = { claude: 0, codex: 1, gemini: 2 };

// ─── 공개 API ────────────────────────────────────────────

/**
 * 커스텀 Carrier를 등록합니다.
 *
 * 프레임워크가 자동으로:
 *  - 상호 배타적 carrier 전환 (globalThis 공유)
 *  - 에이전트 패널 모드 설정 + 표시/숨김
 *  - 입력 인터셉트 (글로벌 1회만 등록)
 *  - 메시지 렌더러 등록
 */
export function registerCarrier(
  pi: ExtensionAPI,
  config: CarrierConfig,
): void {
  const gs = getState();

  // Carrier 상태 등록
  const state: CarrierState = {
    config,
    active: false,
    busy: false,
    abortController: null,
    pi,
    ownsWorkingMessage: false,
  };
  gs.modes.set(config.id, state);

  // registeredOrder에 slot 순으로 삽입 (resume 시 중복 방지: 기존 항목 먼저 제거)
  const existingIdx = gs.registeredOrder.indexOf(config.id);
  if (existingIdx !== -1) gs.registeredOrder.splice(existingIdx, 1);

  const idx = gs.registeredOrder.findIndex((existingId) => {
    const existing = gs.modes.get(existingId);
    return existing != null && existing.config.slot > config.slot;
  });
  if (idx === -1) {
    gs.registeredOrder.push(config.id);
  } else {
    gs.registeredOrder.splice(idx, 0, config.id);
  }

  // ── 단축키 등록 (alt+x 취소만 — 개별 carrier 단축키는 인라인 내비게이션으로 대체) ──
  const keybind = getKeybindAPI();

  if (!gs.cancelShortcutRegistered) {
    gs.cancelShortcutRegistered = true;
    keybind.register({
      extension: "fleet",
      action: "cancel",
      defaultKey: "alt+x",
      description: "활성 Carrier 실행 취소",
      category: "Carrier",
      handler: async (ctx) => {
        // 활성 탭이 아닌 carrier도 실행 중일 수 있으므로 모든 carrier를 순회
        const aborted: string[] = [];
        for (const [, s] of getState().modes) {
          if (s.busy && s.abortController) {
            s.abortController.abort();
            aborted.push(s.config.displayName);
          }
        }
        if (aborted.length > 0) {
          ctx.ui.notify(`${aborted.join(", ")} 요청/연결 종료 중...`, "info");
        }
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

  // ── Sortie 도구 온디맨드 재등록 트리거 (debounce) ──
  // 복수 carrier가 동시에 등록될 때 콜백이 N번 발화되는 것을 방지합니다.
  // 모든 carrier 등록이 완료된 직후 단 1회 notifySortieStateChange를 호출합니다.
  if (gs.sortieRegisterTimer) clearTimeout(gs.sortieRegisterTimer);
  gs.sortieRegisterTimer = setTimeout(() => {
    gs.sortieRegisterTimer = null;
    notifySortieStateChange();
  }, 0);
}

/**
 * 특정 carrier를 프로그래밍적으로 활성화합니다.
 */
export function activateCarrier(ctx: ExtensionContext, carrierId: string): boolean {
  const gs = getState();
  const state = gs.modes.get(carrierId);
  if (!state) return false;
  // busy여도 전환(활성화)은 허용 — 단축키 핸들러와 동일 정책

  deactivateAll(ctx);
  state.active = true;
  gs.activeModeId = carrierId;

  const hint = state.config.bottomHint ?? PANEL_EXCLUSIVE_HINT;
  // clis를 함께 전달하여 그룹 carrier 전환 시 컬럼 수도 즉시 재초기화
  setAgentPanelMode(ctx, carrierId, { bottomHint: hint, clis: state.config.clis });
  notifyStatusUpdate();
  return true;
}

/**
 * 특정 carrier를 프로그래밍적으로 비활성화합니다.
 */
export function deactivateCarrier(ctx: ExtensionContext, carrierId: string): void {
  const gs = getState();
  const state = gs.modes.get(carrierId);
  if (state?.active) {
    state.active = false;
    if (gs.activeModeId === carrierId) {
      gs.activeModeId = null;
      setAgentPanelMode(ctx, null);
      hideAgentPanel(ctx);
      notifyStatusUpdate();
    }
  }
}

/**
 * 현재 활성 carrier ID를 반환합니다. (없으면 null)
 */
export function getActiveCarrierId(): string | null {
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

/**
 * slot 순으로 정렬된 carrierId 배열을 반환합니다.
 */
export function getRegisteredOrder(): string[] {
  return [...getState().registeredOrder];
}

// ─── Sortie 가용 상태 관리 ─────────────────────────────

/**
 * 지정 carrier를 sortie에서 비활성화합니다.
 * 독점 모드(패널 독점 뷰)에는 영향 없음.
 */
export function disableSortieCarrier(id: string): void {
  const gs = getState();
  if (!gs.modes.has(id)) return;
  if (gs.sortieDisabledCarriers.has(id)) return;
  gs.sortieDisabledCarriers.add(id);
  notifySortieStateChange();
}

/**
 * 지정 carrier를 sortie에서 다시 활성화합니다.
 */
export function enableSortieCarrier(id: string): void {
  const gs = getState();
  if (!gs.sortieDisabledCarriers.has(id)) return;
  gs.sortieDisabledCarriers.delete(id);
  notifySortieStateChange();
}

/**
 * 지정 carrier가 sortie에서 활성 상태인지 반환합니다.
 */
export function isSortieCarrierEnabled(id: string): boolean {
  return !getState().sortieDisabledCarriers.has(id);
}

/**
 * sortie 가용한 carrier ID만 registeredOrder 순서로 반환합니다.
 */
export function getSortieEnabledIds(): string[] {
  const gs = getState();
  return gs.registeredOrder.filter((id) => !gs.sortieDisabledCarriers.has(id));
}

/**
 * 현재 sortie 비활성화된 carrier ID 목록을 반환합니다.
 */
export function getSortieDisabledIds(): string[] {
  return [...getState().sortieDisabledCarriers];
}

/**
 * sortie 비활성화 목록을 일괄 설정합니다.
 * @param silent true면 콜백을 호출하지 않음 (부팅 시 복원용)
 */
export function setSortieDisabledCarriers(ids: string[], silent = false): void {
  const gs = getState();
  gs.sortieDisabledCarriers = new Set(ids);
  if (!silent) notifySortieStateChange();
}

/**
 * sortie 상태 변경 시 호출될 콜백을 등록합니다.
 * 재초기화(/reload) 시 이전 콜백이 누적되지 않도록 기존 목록을 클리어합니다.
 */
export function onSortieStateChange(callback: () => void): void {
  replaceStateChangeCallbacks("sortieStateChangeCallbacks", callback);
}

// ─── Task Force 설정 변경 관리 ──────────────────────────

/**
 * Task Force 설정 변경 시 호출될 콜백을 등록합니다.
 * 재초기화(/reload) 시 이전 콜백이 누적되지 않도록 기존 목록을 클리어합니다.
 */
export function onTaskForceConfigChange(callback: () => void): void {
  replaceStateChangeCallbacks("taskforceConfigChangeCallbacks", callback);
}

/**
 * Task Force 설정 변경 콜백을 모두 호출합니다.
 * taskforce-config-overlay에서 설정 저장/리셋 성공 시 호출합니다.
 */
export function notifyTaskForceConfigChange(): void {
  notifyStateChangeCallbacks("taskforceConfigChangeCallbacks");
}

/**
 * registeredOrder를 CliType 우선순위(claude→codex→gemini)로 재정렬합니다.
 * 같은 CliType 내에서는 slot 순서를 유지합니다.
 * registerSingleCarrier 호출 시점마다 자동으로 실행됩니다.
 */
export function reorderRegisteredByCliType(): void {
  const gs = getState();
  gs.registeredOrder.sort((a, b) => {
    const configA = gs.modes.get(a)?.config;
    const configB = gs.modes.get(b)?.config;
    const orderA = CLI_TYPE_DISPLAY_ORDER[configA?.cliType ?? ""] ?? 99;
    const orderB = CLI_TYPE_DISPLAY_ORDER[configB?.cliType ?? ""] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    // 같은 CliType 내에서는 slot 순 유지
    return (configA?.slot ?? 99) - (configB?.slot ?? 99);
  });
}

/**
 * carrierId에 해당하는 CarrierConfig를 반환합니다.
 */
export function getRegisteredCarrierConfig(carrierId: string): CarrierConfig | undefined {
  return getState().modes.get(carrierId)?.config;
}

/**
 * 등록된 전체 carrierId를 순회하여 cliType Set으로 수집하고,
 * 중복 제거 후 배열로 반환합니다.
 */
export function getAllCliTypes(): CliType[] {
  const gs = getState();
  const types = new Set<string>();
  for (const id of gs.registeredOrder) {
    const cliType = gs.modes.get(id)?.config.cliType;
    if (cliType) types.add(cliType);
  }
  return [...types] as CliType[];
}

/** carrierId 기준으로 전경(프레임) 색상을 반환합니다. */
export function resolveCarrierColor(carrierId: string): string {
  const cliType = getRegisteredCarrierConfig(carrierId)?.cliType ?? carrierId;
  return CARRIER_COLORS[cliType] ?? "";
}

/** carrierId 기준으로 배경색을 반환합니다. */
export function resolveCarrierBgColor(carrierId: string): string {
  const cliType = getRegisteredCarrierConfig(carrierId)?.cliType ?? carrierId;
  return CARRIER_BG_COLORS[cliType] ?? "";
}

/** carrierId 기준으로 파도 그라데이션용 RGB를 반환합니다. */
export function resolveCarrierRgb(carrierId: string): [number, number, number] {
  const cliType = getRegisteredCarrierConfig(carrierId)?.cliType ?? carrierId;
  return CARRIER_RGBS[cliType] ?? DEFAULT_CARRIER_RGB;
}

/** carrierId 기준으로 carrier 표시 이름을 반환합니다. */
export function resolveCarrierDisplayName(carrierId: string): string {
  const carrierConfig = getRegisteredCarrierConfig(carrierId);
  if (carrierConfig?.displayName) return carrierConfig.displayName;
  return CLI_DISPLAY_NAMES[carrierId] ?? carrierId;
}

/** carrierId 기준으로 실제 CLI 표시 이름을 반환합니다. */
export function resolveCarrierCliDisplayName(carrierId: string): string {
  const cliType = getRegisteredCarrierConfig(carrierId)?.cliType ?? carrierId;
  return CLI_DISPLAY_NAMES[cliType] ?? cliType;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────

/** globalThis 기반 공유 상태를 반환합니다. */
function getState(): CarrierFrameworkState {
  let s = (globalThis as any)[CARRIER_FRAMEWORK_KEY] as CarrierFrameworkState | undefined;
  if (!s) {
    s = {
      modes: new Map(),
      registeredOrder: [],
      activeModeId: null,
      inputRegistered: false,
      cancelShortcutRegistered: false,
      statusUpdateCallbacks: [],
      sortieDisabledCarriers: new Set(),
      sortieStateChangeCallbacks: [],
      sortieRegisterTimer: null,
      taskforceConfigChangeCallbacks: [],
    };
    (globalThis as any)[CARRIER_FRAMEWORK_KEY] = s;
  }
  return s;
}

/** 모든 carrier를 비활성화합니다. (패널은 활성화 코드에서 관리) */
function deactivateAll(_ctx: ExtensionContext) {
  const gs = getState();
  for (const [_id, state] of gs.modes) {
    state.active = false;
  }
  gs.activeModeId = null;
}

/** 지정 carrier를 제외하고 아직 busy인 carrier를 하나 반환합니다. */
function findNextBusyCarrier(excludeId: string): CarrierState | null {
  const gs = getState();
  for (const [id, state] of gs.modes) {
    if (id !== excludeId && state.busy) return state;
  }
  return null;
}

function applyWorkingMessage(ctx: ExtensionContext, state: CarrierState): void {
  if (!state.config.showWorkingMessage) {
    state.ownsWorkingMessage = false;
    return;
  }

  ctx.ui.setWorkingMessage(`${state.config.displayName} is processing...`);
  state.ownsWorkingMessage = true;
}

function clearWorkingMessageIfOwned(ctx: ExtensionContext, state: CarrierState): void {
  if (!state.ownsWorkingMessage) {
    return;
  }

  ctx.ui.setWorkingMessage();
  state.ownsWorkingMessage = false;
}

/** sortie 상태 변경 콜백을 모두 호출합니다. */
function notifySortieStateChange(): void {
  notifyStateChangeCallbacks("sortieStateChangeCallbacks");
}

function replaceStateChangeCallbacks(
  key: "sortieStateChangeCallbacks" | "taskforceConfigChangeCallbacks",
  callback: () => void,
): void {
  getState()[key] = [callback];
}

function notifyStateChangeCallbacks(
  key: "sortieStateChangeCallbacks" | "taskforceConfigChangeCallbacks",
): void {
  for (const callback of getState()[key]) {
    try { callback(); } catch { /* 무시 */ }
  }
}

/** Carrier 실행 (fire-and-forget으로 호출됨) */
async function executeCarrier(
  state: CarrierState,
  ctx: ExtensionContext,
  request: string,
) {
  const { config } = state;
  const modePi = state.pi;
  // race condition 방지: abort 가능 시점을 앞당기기 위해 즉시 할당
  const abortController = new AbortController();
  state.abortController = abortController;

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

  applyWorkingMessage(ctx, state);

  try {
    const helpers: CarrierHelpers = {
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
    const nextBusy = findNextBusyCarrier(config.id);
    if (nextBusy?.config.showWorkingMessage) {
      clearWorkingMessageIfOwned(ctx, state);
      applyWorkingMessage(ctx, nextBusy);
    } else {
      clearWorkingMessageIfOwned(ctx, state);
    }
  }
}

function registerInputHandler(pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    const gs = getState();

    // 활성 carrier가 없으면 패스
    if (!gs.activeModeId) return { action: "continue" as const };

    // 확장(sendUserMessage)에서 보낸 메시지는 PI 기본 처리로 전달
    // → Carrier를 우회하여 PI의 메인 LLM이 직접 처리
    if ((event as any).source === "extension") return { action: "continue" as const };

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
    executeCarrier(state, ctx, request).catch((e) => {
      console.error(`[fleet] executeCarrier 미처리 에러:`, e);
    });

    return { action: "handled" as const };
  });
}
