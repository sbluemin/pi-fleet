/**
 * fleet — Carrier PI 확장 진입점
 *
 * SDK 초기화 + 세션 이벤트 + N개 Carrier 등록
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+h/l → 인라인 슬롯 내비게이션 (←/→)               │
 * │ ctrl+enter → 선택 Carrier 상세 뷰 토글               │
 * │ alt+o → 캐리어 함대 현황 오버레이                      │
 * └──────────────────────────────────────────────────────┘
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  onStatusUpdate,
} from "./shipyard/carrier/framework.js";
import { registerModelCommands, syncModelConfig } from "./shipyard/carrier/model-ui.js";
import { bindPanelBackgroundJobAnimation } from "./bridge/panel/lifecycle.js";
import { registerAgentPanelShortcut } from "./bridge/panel/shortcuts.js";
import { bootAdmiral } from "./admiral/index.js";
import {
  initializeFleetRuntime,
  resolveFleetDataDir,
  restoreFleetPreRegistrationState,
  shouldBootFleet,
} from "./boot.js";
import { scheduleFleetBootReconciliation } from "./boot-reconciliation.js";
import { bootBridge } from "./bridge/index.js";
import { registerCarrierStatusKeybind } from "./bridge/carrier-ui/status-overlay-keybind.js";
import { registerFleetCarriers } from "./carriers/index.js";
import { registerFleetPiCommands } from "./pi-commands.js";
import { wireFleetPiEvents } from "./pi-events.js";
import { registerFleetPiTools } from "./pi-tools.js";
export type { CollectedStreamData } from "./bridge/streaming/types.js";

export { runAgentRequest } from "./operation-runner.js";

export {
  loadModels as getModelConfig,
  updateModelSelection,
  updateAllModelSelections,
  getTaskForceModelConfig,
  updateTaskForceModelSelection,
  resetTaskForceModelSelection,
  isTaskForceFormable,
  getConfiguredTaskForceCarrierIds,
  getConfiguredTaskForceBackends,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
  updateCliTypeOverride,
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
  if (!shouldBootFleet()) return;

  const dataDir = resolveFleetDataDir();
  initializeFleetRuntime(dataDir);
  restoreFleetPreRegistrationState();

  bootAdmiral(pi);
  bootBridge(pi);
  bindPanelBackgroundJobAnimation();

  registerFleetCarriers(pi);
  scheduleFleetBootReconciliation();

  registerFleetPiTools(pi);

  syncModelConfig();
  registerAgentPanelShortcut();
  registerModelCommands(pi);
  registerCarrierStatusKeybind(pi);
  wireFleetPiEvents(pi);

  onStatusUpdate(() => { syncModelConfig(); });

  registerFleetPiCommands(pi);
}
