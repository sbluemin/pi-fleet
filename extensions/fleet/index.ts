/**
 * fleet — Carrier PI 확장 진입점
 *
 * SDK 초기화 + 세션 이벤트 + N개 Carrier 등록
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+h/l → 인라인 슬롯 내비게이션 (←/→)               │
 * │ ctrl+enter → 선택 Carrier 상세 뷰 토글               │
 * │ alt+t → Carrier Bridge (PTY 네이티브 브리지)         │
 * │ alt+x → 선택 Carrier 실행 취소                       │
 * │ alt+shift+m → Carrier 모델/추론 설정 변경             │
 * │ alt+o → 캐리어 함대 현황 오버레이                      │
 * └──────────────────────────────────────────────────────┘
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import {
  onStatusUpdate,
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
  onTaskForceConfigChange,
  updateCarrierCliType,
  setPendingCliTypeOverrides,
} from "./shipyard/carrier/framework.js";
import {
  initRuntime,
  onHostSessionChange,
} from "../core/agent/runtime.js";
import {
  initStore,
  loadModels as getModelConfig,
  updateModelSelection,
  getTaskForceModelConfig,
  updateTaskForceModelSelection,
  resetTaskForceModelSelection,
  isTaskForceFullyConfigured,
  getPerCliSettings,
  savePerCliSettings,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
  loadSortieDisabled,
  saveSortieDisabled,
  loadCliTypeOverrides,
  saveCliTypeOverrides,
} from "./shipyard/store.js";
import { cleanIdleClients } from "../core/agent/client-pool.js";
import { registerModelCommands, syncModelConfig } from "./shipyard/carrier/model-ui.js";
import { exposeAgentApi } from "./operation-runner.js";
import { refreshAgentPanel } from "./panel/lifecycle.js";
import { registerAgentPanelShortcut } from "./panel/shortcuts.js";
import { setAgentPanelServiceLoading, setAgentPanelServiceStatus } from "./panel/config.js";
import { buildBridgeCommand } from "./shipyard/carrier/launch.js";
import { initServiceStatus, attachStatusContext, refreshStatusNow, getServiceSnapshots, refreshStatusQuiet } from "../core/agent/service-status/store.js";
import { CARRIER_BRIDGE_KEY } from "./constants";
import { registerFleetSortie } from "./shipyard/carrier/sortie.js";
import { registerFleetTaskForce } from "./shipyard/taskforce/index.js";
import {
  TASKFORCE_CLI_TYPES,
  type TaskForceCliType,
} from "./shipyard/taskforce/types.js";
import { TaskForceConfigOverlay } from "./shipyard/carrier/taskforce-config-overlay.js";
import type { TaskForceOverlayCallbacks } from "./shipyard/carrier/taskforce-config-overlay.js";
import { getFocusedCarrierId } from "./panel/state.js";
import { CarrierStatusOverlay } from "./shipyard/carrier/status-overlay.js";
import type { CarrierStatusGroup, CarrierStatusEntry } from "./shipyard/carrier/status-overlay.js";
import type { ProviderKey } from "../core/agent/types.js";

import { getKeybindAPI } from "../core/keybind/bridge.js";
import { SHELL_POPUP_BRIDGE_KEY } from "../core/shell/types.js";
import type { ShellPopupBridge } from "../core/shell/types.js";

export type { CollectedStreamData } from "./streaming/types.js";

export { runAgentRequest, abortCarrierRun } from "./operation-runner.js";

export {
  loadModels as getModelConfig,
  updateModelSelection,
  updateAllModelSelections,
  getTaskForceModelConfig,
  updateTaskForceModelSelection,
  resetTaskForceModelSelection,
  isTaskForceFullyConfigured,
  getConfiguredTaskForceCarrierIds,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "./shipyard/store.js";
export type {
  ModelSelection,
  SelectedModelsConfig,
} from "./shipyard/store.js";

export type { AgentStatus } from "../core/agent/types.js";

export { syncModelConfig, registerModelCommands } from "./shipyard/carrier/model-ui.js";

export {
  registerCarrier,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  getAllCliTypes,
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
  onTaskForceConfigChange,
  notifyTaskForceConfigChange,
} from "./shipyard/carrier/framework.js";

export type {
  CarrierConfig,
} from "./shipyard/carrier/framework.js";

export { registerSingleCarrier } from "./shipyard/carrier/register.js";
export type { SingleCarrierOptions } from "./shipyard/carrier/register.js";
export type { CarrierMetadata, RequestBlock } from "./shipyard/carrier/types.js";

export default function unifiedAgentBridgeExtension(pi: ExtensionAPI) {
  // ── Fleet 런타임 초기화 (영속 파일은 ~/.pi/fleet/ 하위에 저장) ──
  // os.homedir() 직접 사용으로 PI_CODING_AGENT_DIR override와 무관하게 경로를 고정한다.
  const dataDir = path.join(os.homedir(), ".pi", "fleet");
  initRuntime(dataDir);
  initStore(dataDir);
  initServiceStatus({
    setLoading: setAgentPanelServiceLoading,
    setStatus: setAgentPanelServiceStatus,
  });

  exposeAgentApi();

  // ── Sortie 비활성 상태 복원 ──
  // 부팅 시에는 carrier 등록 전이므로 validIds 필터 없이 전체 로드.
  // 아직 미등록 carrier ID도 보존하여 debounced 콜백의 덮어쓰기를 방지한다.
  const restoredDisabled = loadSortieDisabled();
  if (restoredDisabled.length > 0) {
    setSortieDisabledCarriers(restoredDisabled, true);
  }

  // ── cliType 오버라이드 복원 ──
  // 부팅 시 carrier 미등록 상태이므로 validIds 없이 전체 로드 후 pending으로 저장.
  // registerCarrier() 호출 시 자동 적용됨.
  const restoredCliTypeOverrides = loadCliTypeOverrides();
  if (Object.keys(restoredCliTypeOverrides).length > 0) {
    setPendingCliTypeOverrides(restoredCliTypeOverrides as Record<string, CliType>);
  }

  registerFleetSortie(pi);
  registerFleetTaskForce(pi);
  const refreshTaskForceState = () => {
    registerFleetTaskForce(pi);
    notifyStatusUpdate();
  };

  // sortie 상태 변경 시 → 도구 재등록 + 영속화 + 상태바 갱신
  onSortieStateChange(() => {
    registerFleetSortie(pi);
    refreshTaskForceState();
    saveSortieDisabled(getSortieDisabledIds());
  });

  // Task Force 설정 변경 시 → 도구 재등록 + 상태바 갱신
  onTaskForceConfigChange(() => {
    refreshTaskForceState();
  });

  syncModelConfig();
  registerAgentPanelShortcut();
  registerModelCommands(pi);

  const keybind = getKeybindAPI();
  keybind.register({
    extension: "fleet",
    action: "carrier-bridge",
    defaultKey: CARRIER_BRIDGE_KEY,
    description: "현재 carrier 네이티브 브리지 열기",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const bridge = (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY] as ShellPopupBridge | undefined;
      if (!bridge) {
        ctx.ui.notify("core-shell 확장이 로드되지 않았습니다.", "warning");
        return;
      }
      if (bridge.isOpen()) return;

      const targetId = getFocusedCarrierId();

      const carrierConfig = targetId ? getRegisteredCarrierConfig(targetId) : undefined;
      if (!carrierConfig || !targetId) {
        const shell = process.env.SHELL || "/bin/zsh";
        try {
          await bridge.open({ command: shell, title: "Terminal", cwd: ctx.cwd });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`터미널 실행 실패: ${message}`, "error");
        }
        return;
      }

      const command = buildBridgeCommand(targetId, carrierConfig.cliType);
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
  let dismissStatusPopup: (() => void) | null = null;

  keybind.register({
    extension: "fleet",
    action: "carrier-status",
    defaultKey: "alt+o",
    description: "캐리어 함대 현황 오버레이",
    category: "Fleet",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;

      if (activeStatusPopup) {
        dismissStatusPopup?.();
        return;
      }

      const carrierIds = getRegisteredOrder();
      const modelConfig = getModelConfig();
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
        const model = selection?.model || provider.defaultModel;
        const isDefault = !selection?.model;
        const effort = selection?.effort ?? null;
        const budgetTokens = selection?.budgetTokens ?? null;
        const meta = config.carrierMetadata;
        const role = meta?.title ?? null;

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
          roleDescription: meta ? `${meta.title} — ${meta.summary}` : null,
          isSortieEnabled: isSortieCarrierEnabled(id),
        });
      }

      const groups: CarrierStatusGroup[] = [];
      for (const cli of cliOrder) {
        const group = groupMap.get(cli);
        if (group) groups.push(group);
      }

      activeStatusPopup = ctx.ui.custom(
        (tui: any, theme: any, _keybindings: any, done: () => void) => {
          dismissStatusPopup = done;
          return new CarrierStatusOverlay(
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
              hasTaskForceConfig: (carrierId: string) => {
                return isTaskForceFullyConfigured(carrierId);
              },
              updateCliType: (carrierId: string, newCliType: string) => {
                // 1. 현재 CLI 설정 저장
                const currentCliType = getRegisteredCarrierConfig(carrierId)?.cliType;
                if (currentCliType) {
                  const currentConfig = getModelConfig()[carrierId];
                  if (currentConfig) {
                    savePerCliSettings(carrierId, currentCliType, {
                      model: currentConfig.model,
                      effort: currentConfig.effort,
                      budgetTokens: currentConfig.budgetTokens,
                      direct: currentConfig.direct,
                    });
                  }
                }

                // 2. CLI 타입 변경
                updateCarrierCliType(carrierId, newCliType as CliType);
                refreshAgentPanel(ctx);

                // 3. 새 CLI의 저장된 설정 복원 (없으면 기본 모델)
                const saved = getPerCliSettings(carrierId, newCliType);
                const provider = getAvailableModels(newCliType as CliType);
                const effortLevels = getEffortLevels(newCliType as CliType);
                const restoredEffort = saved?.effort && effortLevels?.includes(saved.effort)
                  ? saved.effort
                  : undefined;
                // budgetTokens는 Claude이고 effort가 none이 아닌 경우에만 복원
                const restoredBudget = restoredEffort && restoredEffort !== "none" && newCliType === "claude"
                  ? saved?.budgetTokens
                  : undefined;
                void updateModelSelection(carrierId, {
                  model: saved?.model && provider.models.some(m => m.modelId === saved.model)
                    ? saved.model
                    : provider.defaultModel,
                  effort: restoredEffort,
                  budgetTokens: restoredBudget,
                  direct: saved?.direct,
                });
                syncModelConfig();
                // 영속화: defaultCliType과 다를 때만 override 저장
                const overrides: Record<string, string> = {};
                for (const cid of getRegisteredOrder()) {
                  const cfg = getRegisteredCarrierConfig(cid);
                  if (cfg && cfg.cliType !== cfg.defaultCliType) {
                    overrides[cid] = cfg.cliType;
                  }
                }
                saveCliTypeOverrides(overrides);
                // 오버레이 닫기 (그룹 재구성을 위해)
                dismissStatusPopup?.();
              },
              getDefaultCliType: (carrierId: string) => {
                return getRegisteredCarrierConfig(carrierId)?.defaultCliType ?? "claude";
              },
              openTaskForce: (carrierId: string) => {
                dismissStatusPopup?.();
                const carrierConfig = getRegisteredCarrierConfig(carrierId);
                if (!carrierConfig) {
                  ctx.ui.notify(`등록되지 않은 carrier입니다: ${JSON.stringify(carrierId)}`, "error");
                  return;
                }
                const carrierDisplayName = carrierConfig?.displayName ?? carrierId;
                const allowedTaskForceCliTypes = new Set<string>(TASKFORCE_CLI_TYPES);
                const requireTaskForceCliType = (cliType: string): TaskForceCliType => {
                  if (!allowedTaskForceCliTypes.has(cliType)) {
                    throw new Error(`Unsupported Task Force backend: ${cliType}`);
                  }
                  return cliType as TaskForceCliType;
                };

                const tfCallbacks: TaskForceOverlayCallbacks = {
                  getAvailableModels: (cliType: string) => getAvailableModels(requireTaskForceCliType(cliType)),
                  getEffortLevels: (cliType: string) => getEffortLevels(requireTaskForceCliType(cliType)),
                  getDefaultBudgetTokens,
                  getBackendConfig: (cliType: string) => {
                    const resolvedCliType = requireTaskForceCliType(cliType);
                    const tfConfig = getTaskForceModelConfig(carrierId, resolvedCliType);
                    const modelConfigNow = getModelConfig();
                    const isCustom = !!(modelConfigNow[carrierId]?.taskforce?.[resolvedCliType]);
                    const provider = getAvailableModels(resolvedCliType);
                    return {
                      model: tfConfig?.model ?? provider.defaultModel,
                      effort: tfConfig?.effort ?? null,
                      isCustom,
                    };
                  },
                  updateBackendConfig: async (cliType: string, selection) => {
                    updateTaskForceModelSelection(
                      carrierId,
                      requireTaskForceCliType(cliType),
                      selection,
                    );
                  },
                  resetBackendConfig: (cliType: string) => {
                    resetTaskForceModelSelection(carrierId, requireTaskForceCliType(cliType));
                  },
                };
                void ctx.ui.custom(
                  (tui2: any, theme2: any, _kb2: any, done2: () => void) =>
                    new TaskForceConfigOverlay(tui2, theme2, carrierId, carrierDisplayName, tfCallbacks, done2),
                  {
                    overlay: true,
                    overlayOptions: { width: "60%", maxHeight: "55%", anchor: "center", margin: 1 },
                  },
                );
              },
            },
            done,
          );
        },
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
        refreshStatusQuiet();
        await activeStatusPopup;
      } finally {
        activeStatusPopup = null;
        dismissStatusPopup = null;
      }
    },
  });

  const onSessionChange = (ctx: ExtensionContext) => {
    onHostSessionChange(ctx.sessionManager.getSessionId());
    cleanIdleClients();
    refreshAgentPanel(ctx);
    attachStatusContext(ctx);

    if (!(globalThis as any).__pi_admiral_extension_loaded__ && !(globalThis as any).__pi_admiral_missing_warned__) {
      (globalThis as any).__pi_admiral_missing_warned__ = true;
      ctx.ui.notify(
        "Admiral extension is not loaded. Add extensions/admiral to restore Admiral prompts and worldview controls.",
        "warning",
      );
    }
  };

  pi.on("session_start", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_tree", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });

  pi.on("session_shutdown", async (_event, ctx) => {
    delete (globalThis as any).__pi_admiral_missing_warned__;

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

}
