/**
 * core/index.ts — 코어 계층 공개 Facade
 *
 * feature 모듈(modes/, tools/, model-selection/, status/, shell/)은
 * 이 파일을 통해서만 core 기능에 접근합니다.
 *
 * 예외: index.ts(엔트리포인트), types.ts(공개 타입), tests/ 는
 * core 내부를 직접 참조할 수 있습니다.
 */

// ─── 도메인 타입 (contracts) ────────────────────────────

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

// ─── 오케스트레이터 (실행 진입점) ───────────────────────

export {
  runAgentRequest,
  exposeAgentApi,
  clearStreamWidgets,
  clearCompletedStreamWidgets,
} from "./orchestrator.js";
export type { ExposeAgentApiOptions } from "./orchestrator.js";

// ─── 모델 설정 (타입 + 영속화 + 카탈로그) ──────────────

export {
  loadSelectedModels,
  saveSelectedModels,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "./agent/model-config.js";
export type {
  ModelSelection,
  SelectedModelsConfig,
  ProviderInfo,
} from "./agent/model-config.js";

// ─── 실행 엔진 타입 ────────────────────────────────────

export type {
  AgentStatus,
  ExecuteOptions,
  ExecuteResult,
  ToolCallInfo,
  ConnectionInfo,
} from "./agent/types.js";

// ─── 세션 매핑 ─────────────────────────────────────────

export { createSessionMapStore } from "./agent/session-map.js";
export type { SessionMapStore } from "./agent/session-map.js";

// ─── 패널 lifecycle ────────────────────────────────────

export {
  beginColStreaming,
  endColStreaming,
  startAgentStreaming,
  stopAgentStreaming,
  getAgentPanelCols,
  setAgentPanelMode,
  hideAgentPanel,
  refreshAgentPanelFooter,
  setAgentPanelSessionStore,
  getModeBannerLines,
  onPanelToggle,
  isAgentPanelExpanded,
} from "./panel/lifecycle.js";

// ─── 패널 설정 ─────────────────────────────────────────

export {
  setAgentPanelModelConfig,
  setAgentPanelServiceLoading,
  setAgentPanelServiceStatus,
  setServiceStatusRenderer,
} from "./panel/config.js";

// ─── 패널 단축키 ───────────────────────────────────────

export { registerAgentPanelShortcut } from "./panel/shortcuts.js";

// ─── 메시지 렌더러 ─────────────────────────────────────

export {
  createDefaultUserRenderer,
  createDefaultResponseRenderer,
  createToolResultRenderer,
} from "./render/message-renderers.js";
export type { AgentRenderConfig } from "./render/message-renderers.js";

// ─── 클라이언트 풀 ─────────────────────────────────────

export { disconnectClient, cleanIdleClients } from "./agent/client-pool.js";
