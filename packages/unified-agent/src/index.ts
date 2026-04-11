/**
 * @sbluemin/unified-agent
 * Codex CLI, Claude Code, Gemini CLI 통합 SDK
 * 공식 ACP SDK (@agentclientprotocol/sdk) 기반
 *
 * @example
 * ```typescript
 * import { UnifiedAgentClient } from '@sbluemin/unified-agent';
 *
 * const client = new UnifiedAgentClient();
 * client.on('messageChunk', (text) => process.stdout.write(text));
 * await client.connect({ cwd: '/my/workspace', cli: 'gemini' });
 * await client.sendMessage('이 프로젝트를 분석해줘');
 * ```
 */

// === 통합 클라이언트 ===
export {
  UnifiedAgentClient,
  type UnifiedClientEvents,
  type ConnectResult,
  type ConnectionInfo,
  type IUnifiedAgentClient,
} from './client/UnifiedAgentClient.js';

// === 모델 레지스트리 ===
export {
  getModelsRegistry,
  getProviderModels,
  getProviderModelIds,
  getReasoningEffortLevels,
} from './models/ModelRegistry.js';

export type {
  ModelsRegistry,
  ProviderModelInfo,
  ModelEntry,
  ReasoningEffort,
} from './models/schemas.js';

// === 연결 모듈 ===
export { BaseConnection, type BaseConnectionOptions } from './connection/BaseConnection.js';
export { AcpConnection, createIdleTimeoutRace, type AcpConnectionOptions, type AcpConnectionEventMap } from './connection/AcpConnection.js';

// === CLI 감지 ===
export { CliDetector } from './detector/CliDetector.js';

// === 프로세스 풀 ===
export { getProcessPool, ProcessPool, type ProcessPoolOptions, type WarmUpOptions } from './pool/ProcessPool.js';

// === CLI 설정 ===
export {
  CLI_BACKENDS,
  createSpawnConfig,
  createPreSpawnConfig,
  getBackendConfig,
  getAllBackendConfigs,
} from './config/CliConfigs.js';

// === 공식 ACP SDK re-export ===
export {
  ClientSideConnection,
  AgentSideConnection,
  ndJsonStream,
  RequestError,
} from '@agentclientprotocol/sdk';

export type {
  Client as AcpClient,
  Agent as AcpAgent,
  Stream as AcpStream,
  McpServer as AcpMcpServer,
} from '@agentclientprotocol/sdk';

// === 타입 ===
export type {
  // 공통
  ConnectionState,
  ClientInfo,
  ConnectionEvents,
} from './types/common.js';

export type {
  // ACP (공식 SDK alias)
  AcpInitializeParams,
  AcpInitializeResult,
  AcpSessionNewParams,
  AcpSessionNewResult,
  AcpSessionLoadParams,
  AcpSessionLoadResult,
  AcpSessionCancelParams,
  AcpSessionPromptParams,
  AcpPromptResponse,
  AcpSessionSetModeParams,
  AcpSessionSetModelParams,
  AcpSessionSetConfigParams,
  AcpSessionUpdateType,
  AcpSessionUpdateParams,
  AcpSessionUpdate,
  AcpAvailableCommandsUpdate,
  AcpAvailableCommand,
  AcpPermissionRequestParams,
  AcpPermissionOption,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
  AcpContentBlock,
  AcpTextContent,
  AcpImageContent,
  AcpResourceLink,
  AcpConfigOption,
  AcpSessionMode,
  AcpStopReason,
  AcpSessionModelState,
  AcpModelInfo,
  AcpModelId,
  AcpEvents,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpToolCallContent,
  AcpToolCallStatus,
  AcpToolKind,
} from './types/acp.js';

export type {
  // 설정
  CliType,
  ProtocolType,
  AgentMode,
  CliSpawnConfig,
  CliBackendConfig,
  ConnectionOptions,
  CliDetectionResult,
  UnifiedClientOptions,
  PreSpawnedHandle,
} from './types/config.js';

// === 유틸리티 ===
export { cleanEnvironment, isWindows } from './utils/env.js';
export { killProcess, killProcessGroup } from './utils/process.js';
export { resolveNpxPath, buildNpxArgs } from './utils/npx.js';
