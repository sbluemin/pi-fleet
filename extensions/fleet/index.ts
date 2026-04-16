/**
 * fleet — Carrier PI 확장 진입점
 *
 * SDK 초기화 + 세션 이벤트 + N개 Carrier 등록
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+h/l → 인라인 슬롯 내비게이션 (←/→)               │
 * │ ctrl+enter → 선택 Carrier 상세 뷰 토글               │
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
  resolveCarrierDisplayName,
  disableSortieCarrier,
  enableSortieCarrier,
  isSortieCarrierEnabled,
  getSortieDisabledIds,
  setSortieDisabledCarriers,
  onSortieStateChange,
  onTaskForceConfigChange,
  setTaskForceConfiguredCarriers,
  updateCarrierCliType,
  setPendingCliTypeOverrides,
  enableSquadronCarrier,
  disableSquadronCarrier,
  isSquadronCarrierEnabled,
  getSquadronEnabledIds,
  setSquadronEnabledCarriers,
  onSquadronStateChange,
} from "./shipyard/carrier/framework.js";
import {
  initRuntime,
  onHostSessionChange,
} from "../core/agentclientprotocol/runtime.js";
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
  reconcileActiveModelSelections,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
  loadSortieDisabled,
  saveSortieDisabled,
  loadSquadronEnabled,
  saveSquadronEnabled,
  loadCliTypeOverrides,
  saveCliTypeOverrides,
  getConfiguredTaskForceCarrierIds,
} from "./shipyard/store.js";
import { cleanIdleClients } from "../core/agentclientprotocol/pool.js";
import { registerModelCommands, syncModelConfig } from "./shipyard/carrier/model-ui.js";
import { exposeAgentApi } from "./operation-runner.js";
import { refreshAgentPanel } from "./panel/lifecycle.js";
import { registerAgentPanelShortcut } from "./panel/shortcuts.js";
import { setAgentPanelServiceLoading, setAgentPanelServiceStatus } from "./panel/config.js";
import { initServiceStatus, attachStatusContext, refreshStatusNow, getServiceSnapshots, refreshStatusQuiet } from "../core/agentclientprotocol/service-status/store.js";
import { registerFleetSortie } from "./shipyard/carrier/sortie.js";
import { registerFleetTaskForce } from "./shipyard/taskforce/index.js";
import { registerFleetSquadron } from "./shipyard/squadron/index.js";
import {
  TASKFORCE_CLI_TYPES,
  type TaskForceCliType,
} from "./shipyard/taskforce/types.js";
import { TaskForceConfigOverlay } from "./shipyard/carrier/taskforce-config-overlay.js";
import type { TaskForceOverlayCallbacks } from "./shipyard/carrier/taskforce-config-overlay.js";
import { CarrierStatusOverlay } from "./shipyard/carrier/status-overlay.js";
import { StatusOverlayController } from "./shipyard/carrier/status-overlay-controller.js";
import type {
  CarrierCliType,
  CarrierStatusEntry,
  CliModelInfo,
  ModelSelection as OverlayModelSelection,
} from "./shipyard/carrier/types.js";
import {
  appendAdmiralSystemPrompt,
  buildAcpSystemPrompt,
  buildAcpRuntimeContext,
  isWorldviewEnabled,
  setWorldviewEnabled,
} from "./admiral/prompts.js";
import { getAllProtocols, getActiveProtocol, setActiveProtocol } from "./admiral/protocols/index.js";
import { registerProtocolWidget, updateProtocolWidget } from "./admiral/widget.js";
import registerRequestDirective from "./admiral/request-directive.js";
import { launchBridgeShell } from "./bridge/handler.js";
import {
  BRIDGE_ACTION_ID,
  BRIDGE_COMMAND_ID,
  BRIDGE_DEFAULT_KEY,
  BRIDGE_EXTENSION_ID,
  BRIDGE_KEYBIND_CATEGORY,
} from "./bridge/types.js";
import { registerGenesisCarrier } from "./carriers/genesis.js";
import { registerAthenaCarrier } from "./carriers/athena.js";
import { registerSentinelCarrier } from "./carriers/sentinel.js";
import { registerVanguardCarrier } from "./carriers/vanguard.js";
import { registerEchelonCarrier } from "./carriers/echelon.js";
import { registerChronicleCarrier } from "./carriers/chronicle.js";
import { registerOracleCarrier } from "./carriers/oracle.js";
import { getKeybindAPI } from "../core/keybind/bridge.js";
import { getSettingsAPI } from "../core/settings/bridge.js";
import { PROVIDER_ID, setCliRuntimeContext, setCliSystemPrompt } from "../core/agentclientprotocol/provider-types.js";
import { setEditorBorderColor, setEditorRightLabel } from "../core/hud/border-bridge.js";
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

export type { AgentStatus } from "../core/agentclientprotocol/types.js";

export { syncModelConfig, registerModelCommands } from "./shipyard/carrier/model-ui.js";

export {
  registerCarrier,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  getAllCliTypes,
  onStatusUpdate,
  notifyStatusUpdate,
  resolveCarrierBgColor,
  resolveCarrierRgb,
  resolveCarrierDisplayName,
  disableSortieCarrier,
  enableSortieCarrier,
  isSortieCarrierEnabled,
  getSortieEnabledIds,
  getSortieDisabledIds,
  setSortieDisabledCarriers,
  onSortieStateChange,
  onTaskForceConfigChange,
  notifyTaskForceConfigChange,
  enableSquadronCarrier,
  disableSquadronCarrier,
  isSquadronCarrierEnabled,
  getSquadronEnabledIds,
} from "./shipyard/carrier/framework.js";
export {
  resolveCarrierColor,
  resolveCarrierCliDisplayName,
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

  // ── Squadron 활성 상태 복원 ──
  const restoredSquadron = loadSquadronEnabled();
  if (restoredSquadron.length > 0) {
    setSquadronEnabledCarriers(restoredSquadron, true);
  }

  // ── cliType 오버라이드 복원 ──
  // 부팅 시 carrier 미등록 상태이므로 validIds 없이 전체 로드 후 pending으로 저장.
  // registerCarrier() 호출 시 자동 적용됨.
  const restoredCliTypeOverrides = loadCliTypeOverrides();
  if (Object.keys(restoredCliTypeOverrides).length > 0) {
    setPendingCliTypeOverrides(restoredCliTypeOverrides as Record<string, CliType>);
  }

  const bootProtocol = getActiveProtocol();
  syncProtocolToHud(bootProtocol);
  registerAdmiralSettingsSection();
  registerRequestDirective(pi);
  registerProtocolKeybinds();

  registerBridgeKeybind();

  registerGenesisCarrier(pi);
  registerAthenaCarrier(pi);
  registerOracleCarrier(pi);
  registerSentinelCarrier(pi);
  registerVanguardCarrier(pi);
  registerEchelonCarrier(pi);
  registerChronicleCarrier(pi);

  registerFleetSortie(pi);
  registerFleetTaskForce(pi);
  registerFleetSquadron(pi);
  const refreshTaskForceState = () => {
    // globalThis 캐시를 먼저 갱신해 크로스 번들에서 동일 상태를 읽게 합니다.
    const tfIds = getConfiguredTaskForceCarrierIds(getRegisteredOrder());
    setTaskForceConfiguredCarriers(tfIds, true);
    registerFleetTaskForce(pi);
    notifyStatusUpdate();
  };
  let hasReconciledInitialModelSelections = false;

  // sortie 상태 변경 시 → 도구 재등록 + 영속화 + 상태바 갱신
  // carrier 등록 완료 후 debounce를 통해 최초 1회 발화됨 → stale squadron ID도 이 시점에 정리
  onSortieStateChange(() => {
    registerFleetSortie(pi);
    registerFleetSquadron(pi);
    refreshTaskForceState();
    saveSortieDisabled(getSortieDisabledIds());
    if (!hasReconciledInitialModelSelections) {
      const cliTypesByCarrier = Object.fromEntries(
        getRegisteredOrder()
          .map((carrierId) => {
            const config = getRegisteredCarrierConfig(carrierId);
            return config ? [carrierId, config.cliType] : null;
          })
          .filter((entry): entry is [string, CliType] => entry !== null),
      );
      hasReconciledInitialModelSelections = true;
      if (Object.keys(cliTypesByCarrier).length > 0 && reconcileActiveModelSelections(cliTypesByCarrier)) {
        syncModelConfig();
      }
    }
    // 부팅 시 복원된 stale squadron ID 정리 (등록된 carrier와 교집합만 유지)
    const registeredSet = new Set(getRegisteredOrder());
    const validSquadronIds = getSquadronEnabledIds().filter((id) => registeredSet.has(id));
    if (validSquadronIds.length !== getSquadronEnabledIds().length) {
      setSquadronEnabledCarriers(validSquadronIds, true);
      saveSquadronEnabled(validSquadronIds);
    }
  });

  // squadron 상태 변경 시 → sortie/squadron 도구 재등록 + 영속화 + 상태바 갱신
  onSquadronStateChange(() => {
    registerFleetSortie(pi);
    registerFleetSquadron(pi);
    // 등록된 carrier ID와의 교집합만 영속화 (미등록 ID 제거)
    const registeredSet = new Set(getRegisteredOrder());
    saveSquadronEnabled(getSquadronEnabledIds().filter((id) => registeredSet.has(id)));
    notifyStatusUpdate();
  });

  // Task Force 설정 변경 시 → 도구 재등록 + 상태바 갱신
  onTaskForceConfigChange(() => {
    refreshTaskForceState();
  });

  syncModelConfig();
  registerAgentPanelShortcut();
  registerModelCommands(pi);

  const keybind = getKeybindAPI();
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
      const entries: CarrierStatusEntry[] = [];

      for (const id of carrierIds) {
        const config = getRegisteredCarrierConfig(id);
        if (!config) continue;

        const cliType = config.cliType;
        const selection = modelConfig[id];
        const provider = getAvailableModels(cliType);
        const model = selection?.model || provider.defaultModel;
        const isDefault = !selection?.model;
        const effort = selection?.effort ?? null;
        const budgetTokens = selection?.budgetTokens ?? null;
        const meta = config.carrierMetadata;
        const role = meta?.title ?? null;

        entries.push({
          carrierId: id,
          slot: config.slot,
          cliType,
          defaultCliType: config.defaultCliType as CarrierCliType,
          displayName: resolveCarrierDisplayName(id),
          model,
          isDefault,
          effort,
          budgetTokens,
          role,
          roleDescription: meta ? `${meta.title} — ${meta.summary}` : null,
          isSortieEnabled: isSortieCarrierEnabled(id),
          isSquadronEnabled: isSquadronCarrierEnabled(id),
          hasTaskForceConfig: isTaskForceFullyConfigured(id),
        });
      }

      activeStatusPopup = ctx.ui.custom(
        (tui: any, theme: any, _keybindings: any, done: () => void) => {
          dismissStatusPopup = done;
          const handleModelUpdated = (): void => {
            syncModelConfig();
            notifyStatusUpdate();
          };

          const getCliModelInfo = (cliType: CarrierCliType): CliModelInfo => {
            const provider = getAvailableModels(cliType as CliType);
            const effortLevels = getEffortLevels(cliType as CliType) ?? [];
            return {
              ...provider,
              defaultBudgetTokens: Object.fromEntries(
                effortLevels.map((level) => [level, getDefaultBudgetTokens(level)]),
              ),
            };
          };

          const overlayController = new StatusOverlayController({
            getEntries: () => entries,
            getRegisteredOrder,
            getRegisteredCarrierConfig: (carrierId: string) => getRegisteredCarrierConfig(carrierId),
            getCurrentModelSelection: (carrierId: string) => getModelConfig()[carrierId],
            getAvailableModels: getCliModelInfo,
            getPerCliSettings: (carrierId: string, cliType: CarrierCliType) => getPerCliSettings(carrierId, cliType),
            savePerCliSettings: (carrierId: string, cliType: CarrierCliType, selection) => {
              savePerCliSettings(carrierId, cliType, selection);
            },
            updateCarrierCliType: (carrierId: string, cliType: CarrierCliType) => {
              updateCarrierCliType(carrierId, cliType as CliType);
            },
            updateModelSelection: async (carrierId: string, selection) => {
              await updateModelSelection(carrierId, selection);
            },
            refreshAgentPanel: () => {
              refreshAgentPanel(ctx);
            },
            syncModelConfig,
            notifyStatusUpdate,
            saveCliTypeOverrides,
          });

          return new CarrierStatusOverlay(
            tui,
            theme,
            entries,
            {
              getEntries: () => entries,
              changeCliType: (carrierId: string, newCliType: CarrierCliType) => {
                return overlayController.changeCliType(carrierId, newCliType);
              },
              changeCliTypes: async (updates: Array<{ carrierId: string; newCliType: CarrierCliType }>) => {
                return overlayController.changeCliTypes(updates);
              },
              resetCliTypesToDefault: async () => {
                return overlayController.resetCliTypesToDefault();
              },
              saveModelSelection: async (carrierId: string, selection: OverlayModelSelection) => {
                await updateModelSelection(carrierId, selection);
                handleModelUpdated();
              },
              toggleSortieEnabled: (carrierId: string) => {
                if (isSortieCarrierEnabled(carrierId)) {
                  disableSortieCarrier(carrierId);
                } else {
                  enableSortieCarrier(carrierId);
                }
              },
              toggleSquadronEnabled: (carrierId: string) => {
                if (isSquadronCarrierEnabled(carrierId)) {
                  disableSquadronCarrier(carrierId);
                } else {
                  enableSquadronCarrier(carrierId);
                }
              },
              getAvailableModels: getCliModelInfo,
              getServiceSnapshots: () =>
                new Map(
                  getServiceSnapshots().map((snapshot) => [snapshot.provider as CarrierCliType, { status: snapshot.status }]),
                ),
              getDefaultCliType: () => "claude",
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
  };

  pi.on("before_agent_start", (event) => {
    syncAcpRuntimeContext();
    return { systemPrompt: appendAdmiralSystemPrompt(event.systemPrompt) };
  });

  pi.on("session_start", (_event, ctx) => {
    onSessionChange(ctx);
    syncModelConfig();
    syncProtocolToHud(getActiveProtocol());
    registerAdmiralSettingsSection();
    registerProtocolWidget(ctx);
    syncAcpSystemPrompt(ctx);
    registerBridgeKeybind();
  });

  pi.on("session_tree", (_event, ctx) => {
    onSessionChange(ctx);
    syncModelConfig();
    registerAdmiralSettingsSection();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    setCliSystemPrompt(null);
    setCliRuntimeContext(null);

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

  pi.registerCommand("fleet:admiral:worldview", {
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

  pi.registerCommand(BRIDGE_COMMAND_ID, {
    description: "활성 ACP Model Provider를 오버레이 쉘로 실행",
    handler: async (_args, ctx) => {
      await launchBridgeShell(ctx);
    },
  });
}

function registerProtocolKeybinds(): void {
  const keybind = getKeybindAPI();

  for (const protocol of getAllProtocols()) {
    keybind.register({
      extension: "admiral",
      action: `protocol:${protocol.id}`,
      defaultKey: `alt+${protocol.slot}`,
      description: `프로토콜 전환: ${protocol.name}`,
      category: "Admiral Protocol",
      handler: (ctx: any) => {
        const current = getActiveProtocol();
        if (current.id === protocol.id) {
          return;
        }
        setActiveProtocol(protocol.id);
        syncProtocolToHud(protocol);
        syncAcpRuntimeContext();
        ctx.ui.notify(`Protocol → ${protocol.name}`, "info");
        updateProtocolWidget(ctx);
      },
    });
  }
}

function syncProtocolToHud(protocol: { color: string; shortLabel: string }): void {
  setEditorBorderColor(protocol.color);
  setEditorRightLabel(`${protocol.color}⚓ ${protocol.shortLabel}\x1b[0m`);
}

function syncAcpSystemPrompt(ctx: ExtensionContext): void {
  const isAcp = ctx.model?.provider === PROVIDER_ID;
  if (isAcp) {
    setCliSystemPrompt(buildAcpSystemPrompt());
    syncAcpRuntimeContext();
    return;
  }

  setCliSystemPrompt(null);
  setCliRuntimeContext(null);
}

function syncAcpRuntimeContext(): void {
  setCliRuntimeContext(buildAcpRuntimeContext());
}

function registerAdmiralSettingsSection(): void {
  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: "admiral",
    displayName: "Admiral",
    getDisplayFields() {
      const enabled = isWorldviewEnabled();
      const activeProtocol = getActiveProtocol();
      return [
        { label: "Worldview", value: enabled ? "ON" : "OFF", color: enabled ? "accent" : "dim" },
        { label: "Protocol", value: activeProtocol.shortLabel, color: "accent" },
      ];
    },
  });
}

function registerBridgeKeybind(): void {
  const keybind = getKeybindAPI();
  keybind.register({
    extension: BRIDGE_EXTENSION_ID,
    action: BRIDGE_ACTION_ID,
    defaultKey: BRIDGE_DEFAULT_KEY,
    description: "활성 ACP Model Provider bridge 실행",
    category: BRIDGE_KEYBIND_CATEGORY,
    handler: async (ctx) => {
      await launchBridgeShell(ctx);
    },
  });
}
