/**
 * core/index.ts — 코어 계층 공개 Facade
 *
 * feature 모듈(modes/, tools/, model-selection/, status/, shell/)은
 * 이 파일을 통해서만 core 기능에 접근합니다.
 *
 * 예외: index.ts(엔트리포인트), types.ts(공개 타입), tests/ 는
 * core 내부를 직접 참조할 수 있습니다.
 */

export type {
  ColBlock,
  ColStatus,
  AgentCol,
  CollectedStreamData,
  ProviderKey,
  HealthStatus,
  ServiceSnapshot,
  ServiceStatusRendererFn,
} from "./contracts.js";

export {
  runAgentRequest,
  exposeAgentApi,
  clearStreamWidgets,
  clearCompletedStreamWidgets,
} from "./orchestrator.js";

export {
  initRuntime,
  onHostSessionChange,
  getSessionStore,
  getSessionId,
  getModelConfig,
  updateModelSelection,
  updateAllModelSelections,
  getDataDir,
} from "./agent/runtime.js";

export {
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "./agent/model-config.js";
export type {
  ModelSelection,
  SelectedModelsConfig,
  ProviderInfo,
} from "./agent/model-config.js";

export type {
  AgentStatus,
  ExecuteOptions,
  ExecuteResult,
  ToolCallInfo,
  ConnectionInfo,
} from "./agent/types.js";

export {
  beginColStreaming,
  endColStreaming,
  startAgentStreaming,
  stopAgentStreaming,
  getAgentPanelCols,
  setAgentPanelMode,
  hideAgentPanel,
  refreshAgentPanelFooter,
  getModeBannerLines,
  onPanelToggle,
  isAgentPanelExpanded,
} from "./panel/lifecycle.js";

export {
  setAgentPanelModelConfig,
  setAgentPanelServiceLoading,
  setAgentPanelServiceStatus,
  setServiceStatusRenderer,
} from "./panel/config.js";

export { registerAgentPanelShortcut } from "./panel/shortcuts.js";

export {
  createDefaultUserRenderer,
  createDefaultResponseRenderer,
  createToolResultRenderer,
} from "./render/message-renderers.js";
export type { AgentRenderConfig } from "./render/message-renderers.js";

export { disconnectClient, cleanIdleClients } from "./agent/client-pool.js";
