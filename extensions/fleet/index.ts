/**
 * fleet — Carrier PI 확장 진입점
 *
 * SDK 초기화 + 세션 이벤트 + N개 Carrier 등록
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ alt+{slot} → 해당 Carrier (에이전트 패널 독점 뷰)    │
 * │ alt+t → Carrier Bridge (PTY 네이티브 브리지)         │
 * │ 같은 키 재입력 → 기본 모드 원복                        │
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+shift+m → 활성 Carrier 모델/추론 설정 변경         │
 * │ alt+o → 캐리어 함대 현황 오버레이                      │
 * └──────────────────────────────────────────────────────┘
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  onStatusUpdate,
  getActiveCarrierId,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  notifyStatusUpdate,
  resolveCarrierColor,
  resolveCarrierDisplayName,
  resolveCarrierCliDisplayName,
  disableSortieCarrier,
  enableSortieCarrier,
  isSortieCarrierEnabled,
  getSortieDisabledIds,
  setSortieDisabledCarriers,
  onSortieStateChange,
} from "./shipyard/carrier/framework.js";
import { initRuntime, onHostSessionChange, getModelConfig, updateModelSelection } from "./internal/agent/runtime.js";
import { getAvailableModels, getEffortLevels, getDefaultBudgetTokens } from "./internal/agent/model-config.js";
import { cleanIdleClients } from "./internal/agent/client-pool.js";
import { registerModelCommands, syncModelConfig } from "./internal/agent/model-ui.js";
import { loadSortieDisabled, saveSortieDisabled } from "./shipyard/carrier/sortie-store.js";
import { exposeAgentApi } from "./operation-runner.js";
import { refreshAgentPanelFooter, getModeBannerLines } from "./internal/panel/lifecycle.js";
import { registerAgentPanelShortcut } from "./internal/panel/shortcuts.js";
import { buildBridgeCommand } from "./shipyard/carrier/launch.js";
import { attachStatusContext, refreshStatusNow, getServiceSnapshots, refreshStatusQuiet } from "./internal/service-status/store.js";
import { CARRIER_BRIDGE_KEY } from "./constants";
import { registerCarriers } from "./carriers/index.js";
import { registerFleetSortie } from "./shipyard/carrier/sortie.js";
import { appendAdmiralSystemPrompt, isWorldviewEnabled, setWorldviewEnabled } from "./prompts.js";
import { CarrierStatusOverlay } from "./shipyard/carrier/status-overlay.js";
import type { CarrierStatusGroup, CarrierStatusEntry } from "./shipyard/carrier/status-overlay.js";
import type { ProviderKey } from "./internal/contracts.js";

import { INFRA_SETTINGS_KEY } from "../dock/settings/types.js";
import type { InfraSettingsAPI } from "../dock/settings/types.js";

import { EDITOR_MODE_PROVIDER_KEY } from "../dock/hud/types.js";
import type { EditorModeProvider } from "../dock/hud/types.js";

import { INFRA_KEYBIND_KEY } from "../dock/keybind/types.js";
import type { InfraKeybindAPI } from "../dock/keybind/types.js";
import { SHELL_POPUP_BRIDGE_KEY } from "../dock/shell/types.js";
import type { ShellPopupBridge } from "../dock/shell/types.js";

export type { CollectedStreamData } from "./internal/contracts.js";

export { runAgentRequest } from "./operation-runner.js";

export {
  getModelConfig,
  updateModelSelection,
  updateAllModelSelections,
} from "./internal/agent/runtime.js";

export {
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "./internal/agent/model-config.js";
export type {
  ModelSelection,
  SelectedModelsConfig,
} from "./internal/agent/model-config.js";

export type { AgentStatus } from "./internal/agent/types.js";

export { syncModelConfig, registerModelCommands } from "./internal/agent/model-ui.js";

export {
  registerCarrier,
  activateCarrier,
  deactivateCarrier,
  getActiveCarrierId,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  onStatusUpdate,
  notifyStatusUpdate,
  resolveCarrierColor,
  resolveCarrierBgColor,
  resolveCarrierRgb,
  resolveCarrierDisplayName,
  resolveCarrierCliDisplayName,
  disableSortieCarrier,
  enableSortieCarrier,
  isSortieCarrierEnabled,
  getSortieEnabledIds,
  getSortieDisabledIds,
  setSortieDisabledCarriers,
  onSortieStateChange,
} from "./shipyard/carrier/framework.js";

export type {
  CarrierConfig,
  CarrierHelpers,
  CarrierResult,
} from "./shipyard/carrier/framework.js";

export { registerSingleCarrier } from "./shipyard/carrier/register.js";
export type { SingleCarrierOptions, CarrierToolMetadata } from "./shipyard/carrier/register.js";

export default function unifiedAgentDirectExtension(pi: ExtensionAPI) {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));

  // ── Fleet 런타임 초기화 (영속 파일은 .data/ 하위에 저장) ──
  const dataDir = path.join(extensionDir, ".data");
  initRuntime(dataDir);

  (globalThis as any)[EDITOR_MODE_PROVIDER_KEY] = {
    getActiveModeId: getActiveCarrierId,
    getModeColor: (modeId: string) => resolveCarrierColor(modeId) || null,
    getBannerLines: (width: number) => getModeBannerLines(width),
    onStatusUpdate,
  } satisfies EditorModeProvider;

  exposeAgentApi();

  registerCarriers(pi);

  // ── Sortie 비활성 상태 복원 (등록된 carrier만 필터링) ──
  const validCarrierIds = new Set(getRegisteredOrder());
  const restoredDisabled = loadSortieDisabled(dataDir, validCarrierIds);
  if (restoredDisabled.length > 0) {
    setSortieDisabledCarriers(restoredDisabled, true);
  }

  registerFleetSortie(pi);

  // sortie 상태 변경 시 → 도구 재등록 + 영속화 + 상태바 갱신
  onSortieStateChange(() => {
    registerFleetSortie(pi);
    saveSortieDisabled(dataDir, getSortieDisabledIds());
    notifyStatusUpdate();
  });

  syncModelConfig();
  registerAgentPanelShortcut();
  registerModelCommands(pi);

  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "fleet",
    action: "carrier-bridge",
    defaultKey: CARRIER_BRIDGE_KEY,
    description: "현재 carrier 네이티브 브리지 열기",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const bridge = (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY] as ShellPopupBridge | undefined;
      if (!bridge) {
        ctx.ui.notify("utils-shell 확장이 로드되지 않았습니다.", "warning");
        return;
      }
      if (bridge.isOpen()) return;

      const modeId = getActiveCarrierId();
      const carrierConfig = modeId ? getRegisteredCarrierConfig(modeId) : undefined;
      if (!carrierConfig) {
        const shell = process.env.SHELL || "/bin/zsh";
        try {
          await bridge.open({ command: shell, title: "Terminal", cwd: ctx.cwd });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`터미널 실행 실패: ${message}`, "error");
        }
        return;
      }

      const command = buildBridgeCommand(modeId!, carrierConfig.cliType);
      const title = carrierConfig.displayName;

      try {
        await bridge.open({ command, title, cwd: ctx.cwd });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`브리지 실행 실패: ${message}`, "error");
      }
    },
  });

  // ── 캐리어 함대 현황 오버레이 (Alt+O) ──

  let activeStatusPopup: Promise<void> | null = null;

  keybind.register({
    extension: "fleet",
    action: "carrier-status",
    defaultKey: "alt+o",
    description: "캐리어 함대 현황 오버레이",
    category: "Fleet",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;
      if (activeStatusPopup) return;

      // 데이터 수집
      const carrierIds = getRegisteredOrder();
      const modelConfig = getModelConfig();

      // CLI 타입별 그룹핑
      const groupMap = new Map<string, { header: string; color: string; providerKey: ProviderKey; entries: CarrierStatusEntry[] }>();
      const cliOrder = ["claude", "codex", "gemini"] as const;

      for (const id of carrierIds) {
        const config = getRegisteredCarrierConfig(id);
        if (!config) continue;

        const cliType = config.cliType;
        if (!groupMap.has(cliType)) {
          groupMap.set(cliType, {
            header: resolveCarrierCliDisplayName(id),
            color: resolveCarrierColor(id),
            providerKey: cliType,
            entries: [],
          });
        }

        const selection = modelConfig[id];
        const provider = getAvailableModels(cliType);

        const model = selection?.model ?? provider.defaultModel;
        const isDefault = !selection?.model;
        const effort = selection?.effort ?? null;
        const budgetTokens = selection?.budgetTokens ?? null;

        // carrierDescription에서 괄호 안 역할명 추출 (e.g., "Chief Architect")
        let role: string | null = null;
        if (config.carrierDescription) {
          const match = config.carrierDescription.match(/\(([^)]+)\)/);
          role = match ? match[1] : null;
        }

        groupMap.get(cliType)!.entries.push({
          carrierId: id,
          slot: config.slot,
          cliType,
          displayName: resolveCarrierDisplayName(id),
          color: resolveCarrierColor(id),
          cliDisplayName: resolveCarrierCliDisplayName(id),
          model,
          isDefault,
          effort,
          budgetTokens,
          role,
          roleDescription: config.carrierDescription ?? null,
          isSortieEnabled: isSortieCarrierEnabled(id),
        });
      }

      // CLI 순서대로 그룹 배열 생성
      const groups: CarrierStatusGroup[] = [];
      for (const cli of cliOrder) {
        const group = groupMap.get(cli);
        if (group) groups.push(group);
      }

      activeStatusPopup = ctx.ui.custom(
        (tui: any, theme: any, _keybindings: any, done: () => void) =>
          new CarrierStatusOverlay(
            tui,
            theme,
            groups,
            getServiceSnapshots,
            {
              getAvailableModels,
              getEffortLevels,
              getDefaultBudgetTokens,
              updateModelSelection,
              onModelUpdated: () => {
                syncModelConfig();
                notifyStatusUpdate();
              },
              toggleSortieEnabled: (carrierId: string) => {
                if (isSortieCarrierEnabled(carrierId)) {
                  disableSortieCarrier(carrierId);
                } else {
                  enableSortieCarrier(carrierId);
                }
              },
            },
            done,
          ),
        {
          overlay: true,
          overlayOptions: {
            width: "70%",
            maxHeight: "60%",
            anchor: "center",
            margin: 1,
          },
        },
      );

      try {
        // 오버레이가 열린 후 백그라운드로 서비스 상태 갱신
        refreshStatusQuiet();
        await activeStatusPopup;
      } finally {
        activeStatusPopup = null;
      }
    },
  });

  const onSessionChange = (ctx: ExtensionContext) => {
    onHostSessionChange(ctx.sessionManager.getSessionId());
    cleanIdleClients();
    refreshAgentPanelFooter(ctx);
    attachStatusContext(ctx);
  };

  pi.on("before_agent_start", (event, _ctx) => {
    return {
      systemPrompt: appendAdmiralSystemPrompt(event.systemPrompt),
    };
  });

  pi.on("session_start", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_switch", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_fork", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_tree", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;

    const entries = ctx.sessionManager.getEntries();
    const hasDirectChat = entries.some((e) => e.type === "custom_message");
    if (!hasDirectChat) return;

    const hasAssistant = entries.some(
      (e) => e.type === "message" && (e as any).message?.role === "assistant",
    );
    if (hasAssistant) return;

    const header = ctx.sessionManager.getHeader();
    if (!header) return;

    const dir = path.dirname(sessionFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let content = JSON.stringify(header) + "\n";
    for (const entry of entries) {
      content += JSON.stringify(entry) + "\n";
    }
    writeFileSync(sessionFile, content);
  });

  onStatusUpdate(() => { syncModelConfig(); });

  pi.registerCommand("fleet:agent:status", {
    description: "지원 CLI 서비스 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });

  // ── 세계관 프롬프트 토글 커맨드 ──

  pi.registerCommand("fleet:agent:worldview", {
    description: "세계관(fleet metaphor) 프롬프트 토글 (on/off)",
    handler: async (_args, ctx) => {
      const current = isWorldviewEnabled();
      const next = !current;
      setWorldviewEnabled(next);
      ctx.ui.notify(
        `Fleet Worldview → ${next ? "ON" : "OFF"} (다음 턴부터 적용)`,
        "info",
      );
    },
  });

  // ── 설정 팝업(Alt+/) 섹션 등록 ──

  const infraApi = (globalThis as any)[INFRA_SETTINGS_KEY] as InfraSettingsAPI | undefined;
  infraApi?.registerSection({
    key: "fleet",
    displayName: "Fleet",
    getDisplayFields() {
      const enabled = isWorldviewEnabled();
      return [
        { label: "Worldview", value: enabled ? "ON" : "OFF", color: enabled ? "accent" : "dim" },
      ];
    },
  });
}
