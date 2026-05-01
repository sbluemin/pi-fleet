/**
 * provider-internal/state — ACP provider 공유 상태와 model ID codec.
 *
 * imports → types/interfaces → constants → functions 순서를 유지한다.
 */

import {
  CLI_BACKENDS,
  getModelsRegistry,
  type CliType,
  type IUnifiedAgentClient,
} from "@sbluemin/unified-agent";

export interface ParsedModelId {
  cli: CliType;
  backendModel: string;
}

export interface AcpSessionState {
  sessionKey: string;
  scopeKey: string;
  client: IUnifiedAgentClient | null;
  sessionId: string | null;
  cwd: string;
  lastSystemPromptHash: string;
  cli: CliType;
  firstPromptSent: boolean;
  currentModel: string;
  mcpSessionToken?: string;
  toolHash?: string;
  pendingToolCalls: PendingToolCallState[];
  pendingToolCallNotifier: (() => void) | null;
  activePrompt: ActivePromptState | null;
  sessionGeneration: number;
  needsRecovery: boolean;
  lastError: string | null;
}

export interface ActivePromptState {
  promptId: string;
  sessionGeneration: number;
  retryConsumed: boolean;
  assistantOutputStarted: boolean;
  builtinToolStarted: boolean;
  mcpToolUseStarted: boolean;
}

export interface AcpProviderState {
  sessions: Map<string, AcpSessionState>;
  sessionKeysByScope: Map<string, Set<string>>;
  toolCallToSessionKey: Map<string, string>;
  bridgeScopeSessionKeys: Map<string, string>;
  sessionLaunchConfigs: Map<string, AcpSessionLaunchConfig>;
}

export interface PendingToolCallState {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  emitted: boolean;
}

export interface AcpSessionLaunchConfig {
  modelId: string;
  effort?: string;
  budgetTokens?: number;
}

export interface CliCapability {
  supportsSessionClose: boolean;
  supportsSessionLoad: boolean;
  requiresModelAtSpawn: boolean;
  usesNpxBridge: boolean;
}

export type CliRuntimeContextBuilder = (userRequest: string) => string;

export const GLOBAL_STATE_KEY = Symbol.for("__pi_fleet_acp_state__");
export const ACTIVE_STREAM_KEY = Symbol.for("__pi_fleet_acp_stream__");
export const DEFAULT_REQUEST_TIMEOUT = 600_000;
export const DEFAULT_INIT_TIMEOUT = 60_000;
export const DEFAULT_PROMPT_IDLE_TIMEOUT = 1_800_000;
export const DEFAULT_BRIDGE_SCOPE = "default";
export const CLI_CAPABILITIES: Record<CliType, CliCapability> = Object.fromEntries(
  Object.entries(CLI_BACKENDS).map(([cliType, backend]) => [
    cliType,
    {
      supportsSessionClose: backend.supportsSessionClose,
      supportsSessionLoad: backend.supportsSessionLoad,
      requiresModelAtSpawn: backend.requiresModelAtSpawn,
      usesNpxBridge: backend.usesNpxBridge,
    },
  ]),
) as Record<CliType, CliCapability>;

const CLI_RUNTIME_CONTEXT_KEY = Symbol.for("__pi_fleet_acp_cli_runtime_context__");
const LEGACY_PROVIDER_PREFIX = "Fleet ";
const MODEL_ID_POSTFIX = " (Unified)";
const LEGACY_MODEL_ID_POSTFIX = " (ACP)";
const MODEL_LOOKUP: {
  byRegisteredId: Map<string, { cli: CliType; backendModel: string }>;
  byProviderAndRegisteredId: Map<string, { cli: CliType; backendModel: string }>;
  byCliModel: Map<string, string>;
} = (() => {
  const byRegisteredId = new Map<string, { cli: CliType; backendModel: string }>();
  const byProviderAndRegisteredId = new Map<string, { cli: CliType; backendModel: string }>();
  const byCliModel = new Map<string, string>();
  const registry = getModelsRegistry();

  for (const [cliKey, provider] of Object.entries(registry.providers)) {
    const cli = cliKey as CliType;
    if (!CLI_BACKENDS[cli]) continue;
    const providerIds = buildProviderIdAliases(cli);
    for (const model of provider.models) {
      const modelIds = buildModelIdAliases(model.name);
      for (const modelId of [...modelIds, model.modelId]) {
        byRegisteredId.set(modelId, { cli, backendModel: model.modelId });
        for (const providerId of providerIds) {
          byProviderAndRegisteredId.set(`${providerId}\u0000${modelId}`, { cli, backendModel: model.modelId });
        }
      }
      byCliModel.set(`${cli}\u0000${model.modelId}`, modelIds[0]!);
    }
  }

  return { byRegisteredId, byProviderAndRegisteredId, byCliModel };
})();

export function parseModelId(modelId: string, providerId?: string): ParsedModelId | null {
  if (providerId) {
    const lookup = MODEL_LOOKUP.byProviderAndRegisteredId.get(`${providerId}\u0000${modelId}`);
    if (lookup) return { cli: lookup.cli, backendModel: lookup.backendModel };
  }
  const lookup = MODEL_LOOKUP.byRegisteredId.get(modelId);
  if (!lookup) return null;
  return { cli: lookup.cli, backendModel: lookup.backendModel };
}

export function buildModelId(cli: CliType, backendModel: string): string {
  const registeredId = MODEL_LOOKUP.byCliModel.get(`${cli}\u0000${backendModel}`);
  return registeredId ?? `${cli}/${backendModel}`;
}

export function buildProviderId(cli: CliType): string {
  return getCanonicalProviderName(cli);
}

export function getFleetProviderIds(): string[] {
  return Object.keys(getModelsRegistry().providers)
    .map((cli) => buildProviderId(cli as CliType));
}

export function isFleetProviderId(providerId: string): boolean {
  return parseProviderId(providerId) !== null;
}

export function parseProviderId(providerId: string): CliType | null {
  for (const cliKey of Object.keys(getModelsRegistry().providers)) {
    const cli = cliKey as CliType;
    if (!CLI_BACKENDS[cli]) continue;
    if (buildProviderIdAliases(cli).includes(providerId)) return cli;
  }
  return null;
}

export function hashSystemPrompt(prompt: string | undefined): string {
  if (!prompt) return "";
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function getOrInitState(): AcpProviderState {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[GLOBAL_STATE_KEY]) {
    g[GLOBAL_STATE_KEY] = createInitialState();
  }
  return g[GLOBAL_STATE_KEY] as AcpProviderState;
}

export function setBridgeScopeSession(scopeName: string, sessionKey: string): void {
  getOrInitState().bridgeScopeSessionKeys.set(scopeName, sessionKey);
}

export function getBridgeScopeSession(scopeName: string): string | undefined {
  return getOrInitState().bridgeScopeSessionKeys.get(scopeName);
}

export function clearBridgeScopeSessionBySessionKey(sessionKey: string): void {
  const state = getOrInitState();
  for (const [scopeName, mappedSessionKey] of state.bridgeScopeSessionKeys.entries()) {
    if (mappedSessionKey === sessionKey) {
      state.bridgeScopeSessionKeys.delete(scopeName);
    }
  }
}

export function setSessionLaunchConfig(
  sessionKey: string,
  config: AcpSessionLaunchConfig,
): void {
  const state = getOrInitState();
  const previous = state.sessionLaunchConfigs.get(sessionKey);
  state.sessionLaunchConfigs.set(sessionKey, { ...previous, ...config });
}

export function getSessionLaunchConfig(sessionKey: string): AcpSessionLaunchConfig | undefined {
  return getOrInitState().sessionLaunchConfigs.get(sessionKey);
}

export function clearSessionLaunchConfig(sessionKey: string): void {
  getOrInitState().sessionLaunchConfigs.delete(sessionKey);
}

export function setCliRuntimeContext(builder: CliRuntimeContextBuilder | null): void {
  (globalThis as Record<symbol, unknown>)[CLI_RUNTIME_CONTEXT_KEY] = builder;
}

export function getCliRuntimeContext(): CliRuntimeContextBuilder | null {
  return ((globalThis as Record<symbol, unknown>)[CLI_RUNTIME_CONTEXT_KEY] as CliRuntimeContextBuilder | null) ?? null;
}

function createInitialState(): AcpProviderState {
  return {
    sessions: new Map(),
    sessionKeysByScope: new Map(),
    toolCallToSessionKey: new Map(),
    bridgeScopeSessionKeys: new Map(),
    sessionLaunchConfigs: new Map(),
  };
}

function getCanonicalProviderName(cli: CliType): string {
  return getModelsRegistry().providers[cli]?.name ?? cli;
}

function buildProviderIdAliases(cli: CliType): string[] {
  const canonicalName = getCanonicalProviderName(cli);
  return [canonicalName, `${LEGACY_PROVIDER_PREFIX}${canonicalName}`];
}

function buildModelIdAliases(displayName: string): string[] {
  return [`${displayName}${MODEL_ID_POSTFIX}`, `${displayName}${LEGACY_MODEL_ID_POSTFIX}`, displayName];
}
