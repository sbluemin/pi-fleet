/**
 * core/acp-provider — 공유 타입, 상수, model ID codec 정의
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import {
  getProviderModelsRegistry,
  type CliType,
  type FleetAgentClient,
} from "./provider-client.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/** 파싱된 ACP model ID 구조 */
export interface ParsedModelId {
  /** CLI 종류 (gemini | codex) */
  cli: CliType;
  /** 백엔드 모델 ID (e.g., gemini-2.5-pro) */
  backendModel: string;
}

/** ACP 세션 상태 — pi session 키 기준 관리 */
export interface AcpSessionState {
  /** provider 내부 세션 키 */
  sessionKey: string;
  /** provider scope 키 */
  scopeKey: string;
  /** Fleet provider 클라이언트 인스턴스 */
  client: FleetAgentClient | null;
  /** ACP 세션 ID */
  sessionId: string | null;
  /** 작업 디렉토리 */
  cwd: string;
  /** 마지막 systemPrompt 해시 — drift 감지용 */
  lastSystemPromptHash: string;
  /** 마지막 사용 CLI 종류 */
  cli: CliType;
  /** 첫 프롬프트 전송 여부 — systemPrompt prefix 주입용 */
  firstPromptSent: boolean;
  /** 현재 활성 백엔드 모델 ID — 같은 CLI 내 모델 변경 감지용 */
  currentModel: string;
  /** MCP Bearer 토큰 — 세션별 인증용 */
  mcpSessionToken?: string;
  /** tool 목록 해시 — 변경 감지용 */
  toolHash?: string;
  /** 아직 toolResult를 기다리거나 다음 재진입을 기다리는 MCP tool call FIFO */
  pendingToolCalls: PendingToolCallState[];
  /** 현재 turn에서 pending MCP call을 flush하는 notifier */
  pendingToolCallNotifier: (() => void) | null;
  /** 현재 논리 프롬프트 상태 */
  activePrompt: ActivePromptState | null;
  /** 세션 세대 번호 — stale reject/exit fencing 용도 */
  sessionGeneration: number;
  /** 다음 턴에서 fresh reopen이 필요한지 여부 */
  needsRecovery: boolean;
  /** 마지막 오류 요약 */
  lastError: string | null;
}

/** 논리 프롬프트 단위 retry gate 상태 */
export interface ActivePromptState {
  /** 프롬프트 ID */
  promptId: string;
  /** 프롬프트 시작 시점의 세션 세대 */
  sessionGeneration: number;
  /** 자동 retry 사용 여부 */
  retryConsumed: boolean;
  /** assistant output 시작 여부 */
  assistantOutputStarted: boolean;
  /** CLI built-in tool 시작 여부 */
  builtinToolStarted: boolean;
  /** MCP toolUse 시작 여부 */
  mcpToolUseStarted: boolean;
}

/** provider 전역 상태 — globalThis에 저장 */
export interface AcpProviderState {
  /** pi session 키 → ACP 세션 상태 맵 */
  sessions: Map<string, AcpSessionState>;
  /** scope 키 → provider 세션 키 집합 */
  sessionKeysByScope: Map<string, Set<string>>;
  /** toolCallId → provider 세션 키 역참조 */
  toolCallToSessionKey: Map<string, string>;
  /** bridge scope 이름 → 현재 활성 sessionKey */
  bridgeScopeSessionKeys: Map<string, string>;
  /** sessionKey → bridge launch 메타 */
  sessionLaunchConfigs: Map<string, AcpSessionLaunchConfig>;
}

/** session 내부 MCP tool call FIFO 항목 */
export interface PendingToolCallState {
  /** pi/native toolCallId */
  toolCallId: string;
  /** 호출된 tool 이름 */
  toolName: string;
  /** 호출 인자 */
  args: Record<string, unknown>;
  /** 현재 turn에서 이미 pi로 emit되었는지 여부 */
  emitted: boolean;
}

/** bridge 팝업 재실행에 필요한 최소 launch 메타 */
export interface AcpSessionLaunchConfig {
  /** `acp:<cli>:<backend-model>` 형식 모델 ID */
  modelId: string;
  /** 마지막으로 적용된 reasoning effort */
  effort?: string;
  /** 마지막으로 적용된 Claude budget tokens */
  budgetTokens?: number;
}

/** CLI별 capability 차이를 명시하는 매트릭스 */
export interface CliCapability {
  /** session/close 지원 여부 — reset 가능 여부 결정 */
  supportsSessionClose: boolean;
  /** session/load 지원 여부 — resume 가능 여부 결정 */
  supportsSessionLoad: boolean;
  /** spawn 시 --model 인자 전달 필요 여부 */
  requiresModelAtSpawn: boolean;
  /** npx 브릿지 사용 여부 */
  usesNpxBridge: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Provider 식별자 */
export const PROVIDER_ID = "Fleet ACP";

/** globalThis 키 — module reload 시 상태 보존 */
export const GLOBAL_STATE_KEY = Symbol.for("__pi_fleet_acp_state__");

/** globalThis 키 — 활성 streamSimple 함수 참조 (subagent 중복 등록 방지) */
export const ACTIVE_STREAM_KEY = Symbol.for("__pi_fleet_acp_stream__");

/** globalThis 키 — 매 턴 주입할 런타임 컨텍스트 (프로토콜 전환 태그 등) */
const CLI_RUNTIME_CONTEXT_KEY = Symbol.for("__pi_fleet_acp_cli_runtime_context__");

/** ACP 연결 기본 타임아웃 (ms) */
export const DEFAULT_REQUEST_TIMEOUT = 600_000; // 10분

/** ACP 초기화 기본 타임아웃 (ms) */
export const DEFAULT_INIT_TIMEOUT = 60_000; // 60초

/** ACP 프롬프트 유휴 타임아웃 (ms) */
export const DEFAULT_PROMPT_IDLE_TIMEOUT = 1_800_000; // 30분

/** bridge 확장이 읽는 기본 scope 이름 */
export const DEFAULT_BRIDGE_SCOPE = "default";

/** CLI별 capability 매트릭스 */
export const CLI_CAPABILITIES: Record<"gemini" | "codex" | "claude", CliCapability> = {
  gemini: {
    supportsSessionClose: false,
    supportsSessionLoad: false,
    requiresModelAtSpawn: true,
    usesNpxBridge: false,
  },
  claude: {
    supportsSessionClose: true,
    supportsSessionLoad: true,
    requiresModelAtSpawn: false,
    usesNpxBridge: false,
  },
  codex: {
    supportsSessionClose: true,
    supportsSessionLoad: true,
    requiresModelAtSpawn: false,
    usesNpxBridge: true,
  },
};

/**
 * CLI별 contextWindow / maxTokens 기본값.
 * pi registerProvider 스키마가 이 두 필드를 필수로 요구하지만,
 * Fleet ACP 모델은 백엔드 서브에이전트가 컨텍스트를 관리하므로
 * HUD에서도 context 표시가 숨겨진다. 실질적으로는 스키마 충족 목적.
 */
export const CLI_DEFAULTS: Record<CliType, { contextWindow: number; maxTokens: number }> = {
  claude: { contextWindow: 200_000, maxTokens: 16_384 },
  gemini: { contextWindow: 1_048_576, maxTokens: 65_536 },
  codex: { contextWindow: 200_000, maxTokens: 100_000 },
};

/** Fleet ACP 등록 모델 ID postfix */
const ACP_MODEL_ID_POSTFIX = " (ACP)";

/**
 * 등록 모델 ID ↔ (cli, backendModel) 양방향 매핑.
 * Fleet ACP는 pi Model.id를 models.json의 display name(name)에
 * ` (ACP)` postfix를 붙인 값으로 등록한다.
 * 다만 내부 해석과 기존/신규 상태 호환을 위해 plain name/modelId도
 * 함께 역파싱 fallback으로 유지한다.
 */
const MODEL_LOOKUP: {
  byRegisteredId: Map<string, { cli: CliType; backendModel: string }>;
  byCliModel: Map<string, string>;
} = (() => {
  const byRegisteredId = new Map<string, { cli: CliType; backendModel: string }>();
  const byCliModel = new Map<string, string>();
  const registry = getProviderModelsRegistry();
  for (const [cliKey, provider] of Object.entries(registry.providers)) {
    const cli = cliKey as CliType;
    if (!CLI_DEFAULTS[cli]) continue;
    for (const m of provider.models) {
      byRegisteredId.set(`${m.name}${ACP_MODEL_ID_POSTFIX}`, { cli, backendModel: m.modelId });
      byRegisteredId.set(m.name, { cli, backendModel: m.modelId });
      byRegisteredId.set(m.modelId, { cli, backendModel: m.modelId });
      byCliModel.set(`${cli}\u0000${m.modelId}`, `${m.name}${ACP_MODEL_ID_POSTFIX}`);
    }
  }
  return { byRegisteredId, byCliModel };
})();

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fleet ACP Model ID(현재는 `display name + " (ACP)"`, plain name/modelId도 fallback 지원)를
 * cli / backendModel로 역매핑한다. 등록되지 않은 값이면 null 반환.
 */
export function parseModelId(modelId: string): ParsedModelId | null {
  const lookup = MODEL_LOOKUP.byRegisteredId.get(modelId);
  if (!lookup) return null;
  return { cli: lookup.cli, backendModel: lookup.backendModel };
}

/**
 * cli + backendModel을 Fleet ACP Model ID(= models.json display name + ` (ACP)`)로 변환.
 * 등록되지 않은 조합은 `cli/backendModel` 폴백을 돌려준다.
 */
export function buildModelId(cli: CliType, backendModel: string): string {
  const registeredId = MODEL_LOOKUP.byCliModel.get(`${cli}\u0000${backendModel}`);
  return registeredId ?? `${cli}/${backendModel}`;
}

/**
 * systemPrompt 해시 생성 — drift 감지용.
 * djb2 해시 알고리즘 사용.
 */
export function hashSystemPrompt(prompt: string | undefined): string {
  if (!prompt) return "";
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** globalThis에서 provider 상태를 가져오거나 초기화 */
export function getOrInitState(): AcpProviderState {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[GLOBAL_STATE_KEY]) {
    g[GLOBAL_STATE_KEY] = createInitialState();
  }
  return g[GLOBAL_STATE_KEY] as AcpProviderState;
}

/** 초기 상태 생성 */
function createInitialState(): AcpProviderState {
  return {
    sessions: new Map(),
    sessionKeysByScope: new Map(),
    toolCallToSessionKey: new Map(),
    bridgeScopeSessionKeys: new Map(),
    sessionLaunchConfigs: new Map(),
  };
}

/** bridge scope의 현재 활성 sessionKey를 기록 */
export function setBridgeScopeSession(scopeName: string, sessionKey: string): void {
  const state = getOrInitState();
  state.bridgeScopeSessionKeys.set(scopeName, sessionKey);
}

/** bridge scope에서 현재 활성 sessionKey 조회 */
export function getBridgeScopeSession(scopeName: string): string | undefined {
  const state = getOrInitState();
  return state.bridgeScopeSessionKeys.get(scopeName);
}

/** 특정 sessionKey를 가리키는 bridge scope alias를 모두 제거 */
export function clearBridgeScopeSessionBySessionKey(sessionKey: string): void {
  const state = getOrInitState();
  for (const [scopeName, mappedSessionKey] of state.bridgeScopeSessionKeys.entries()) {
    if (mappedSessionKey === sessionKey) {
      state.bridgeScopeSessionKeys.delete(scopeName);
    }
  }
}

/** sessionKey별 launch 메타를 저장/갱신 */
export function setSessionLaunchConfig(
  sessionKey: string,
  config: AcpSessionLaunchConfig,
): void {
  const state = getOrInitState();
  const previous = state.sessionLaunchConfigs.get(sessionKey);
  state.sessionLaunchConfigs.set(sessionKey, {
    ...previous,
    ...config,
  });
}

/** sessionKey별 launch 메타 조회 */
export function getSessionLaunchConfig(sessionKey: string): AcpSessionLaunchConfig | undefined {
  const state = getOrInitState();
  return state.sessionLaunchConfigs.get(sessionKey);
}

/** sessionKey별 launch 메타 제거 */
export function clearSessionLaunchConfig(sessionKey: string): void {
  const state = getOrInitState();
  state.sessionLaunchConfigs.delete(sessionKey);
}

/**
 * 런타임 컨텍스트 빌더 — 매 턴 사용자 요청 텍스트를 받아
 * 최종 prefix(런타임 태그 + `<user_request>` 래핑 등)를 조립해 반환한다.
 *
 * 외부 확장(admiral 등)이 등록하며, 문자열을 사전 고정하지 않고 매 턴
 * 동적으로 조립하므로 사용자 요청 본문까지 포함한 완성된 prefix를 제공한다.
 */
export type CliRuntimeContextBuilder = (userRequest: string) => string;

/**
 * 매 턴 사용자 메시지 조립에 사용할 런타임 컨텍스트 빌더를 등록한다.
 * null이면 런타임 컨텍스트를 주입하지 않는다.
 */
export function setCliRuntimeContext(builder: CliRuntimeContextBuilder | null): void {
  (globalThis as Record<symbol, unknown>)[CLI_RUNTIME_CONTEXT_KEY] = builder;
}

/**
 * 현재 등록된 런타임 컨텍스트 빌더를 반환한다.
 * 등록되지 않았으면 null을 반환한다.
 */
export function getCliRuntimeContext(): CliRuntimeContextBuilder | null {
  return ((globalThis as Record<symbol, unknown>)[CLI_RUNTIME_CONTEXT_KEY] as CliRuntimeContextBuilder | null) ?? null;
}
