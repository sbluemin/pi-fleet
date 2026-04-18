/**
 * core/acp-provider — 공유 타입, 상수, model ID codec 정의
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import type { CliType } from "@sbluemin/unified-agent";
import type { UnifiedAgentClient } from "@sbluemin/unified-agent";

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
  /** Unified Agent 클라이언트 인스턴스 */
  client: UnifiedAgentClient | null;
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
  /** sendPrompt idle timeout 등으로 reject된 경우 true */
  sendPromptError?: boolean;
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

/** model ID 접두사 — `acp:<cli>:<model>` 형식 */
export const MODEL_ID_PREFIX = "acp";

/** model ID 구분자 */
export const MODEL_ID_SEPARATOR = ":";

/** globalThis 키 — module reload 시 상태 보존 */
export const GLOBAL_STATE_KEY = Symbol.for("__pi_fleet_acp_state__");

/** globalThis 키 — 활성 streamSimple 함수 참조 (subagent 중복 등록 방지) */
export const ACTIVE_STREAM_KEY = Symbol.for("__pi_fleet_acp_stream__");

/** globalThis 키 — 외부에서 설정한 CLI 전용 시스템 지침 */
const CLI_SYSTEM_PROMPT_KEY = Symbol.for("__pi_fleet_acp_cli_system_prompt__");

/** globalThis 키 — 매 턴 주입할 런타임 컨텍스트 (프로토콜 전환 태그 등) */
const CLI_RUNTIME_CONTEXT_KEY = Symbol.for("__pi_fleet_acp_cli_runtime_context__");

/** ACP 연결 기본 타임아웃 (ms) */
export const DEFAULT_REQUEST_TIMEOUT = 600_000; // 10분

/** ACP 초기화 기본 타임아웃 (ms) */
export const DEFAULT_INIT_TIMEOUT = 60_000; // 60초

/** ACP 프롬프트 유휴 타임아웃 (ms) */
export const DEFAULT_PROMPT_IDLE_TIMEOUT = 600_000; // 10분

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
 * 모델 카탈로그 — pi registerProvider에 등록할 모델 목록.
 * model ID는 `acp:<cli>:<backend-model-id>` 형식.
 */
/**
 * 모델 카탈로그 — pi registerProvider에 등록할 모델 목록.
 * models.json(packages/unified-agent)의 레지스트리와 반드시 일치해야 한다.
 * model ID는 `acp:<cli>:<backend-model-id>` 형식.
 *
 */
export const MODEL_CATALOG: Array<{
  id: string;
  name: string;
  cli: CliType;
  backendModel: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}> = [
  // ── Claude 모델군 (models.json providers.claude 기준) ──
  {
    id: "acp:claude:haiku",
    name: "Claude Haiku (ACP)",
    cli: "claude",
    backendModel: "haiku",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 16_384,
  },
  {
    id: "acp:claude:sonnet",
    name: "Claude Sonnet (ACP)",
    cli: "claude",
    backendModel: "sonnet",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 16_384,
  },
  {
    id: "acp:claude:opus",
    name: "Claude Opus (ACP)",
    cli: "claude",
    backendModel: "opus",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 16_384,
  },
  {
    id: "acp:claude:opus[1m]",
    name: "Claude Opus [1M] (ACP)",
    cli: "claude",
    backendModel: "opus[1m]",
    reasoning: true,
    contextWindow: 1_000_000,
    maxTokens: 16_384,
  },
  // ── Gemini 모델군 (models.json providers.gemini 기준) ──
  {
    id: "acp:gemini:gemini-2.5-flash",
    name: "Gemini 2.5 Flash (ACP)",
    cli: "gemini",
    backendModel: "gemini-2.5-flash",
    reasoning: false,
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: "acp:gemini:gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview (ACP)",
    cli: "gemini",
    backendModel: "gemini-3-flash-preview",
    reasoning: false,
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: "acp:gemini:gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview (ACP)",
    cli: "gemini",
    backendModel: "gemini-3.1-pro-preview",
    reasoning: false,
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: "acp:gemini:gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite Preview (ACP)",
    cli: "gemini",
    backendModel: "gemini-3.1-flash-lite-preview",
    reasoning: false,
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  // ── Codex 모델군 (models.json providers.codex 기준) ──
  {
    id: "acp:codex:gpt-5.3-codex",
    name: "GPT-5.3 Codex (ACP)",
    cli: "codex",
    backendModel: "gpt-5.3-codex",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
  {
    id: "acp:codex:gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark (ACP)",
    cli: "codex",
    backendModel: "gpt-5.3-codex-spark",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
  {
    id: "acp:codex:gpt-5.4",
    name: "GPT-5.4 (ACP)",
    cli: "codex",
    backendModel: "gpt-5.4",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
  {
    id: "acp:codex:gpt-5.4-mini",
    name: "GPT-5.4 Mini (ACP)",
    cli: "codex",
    backendModel: "gpt-5.4-mini",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `acp:<cli>:<backend-model>` 형식의 model ID를 파싱.
 * 유효하지 않으면 null 반환.
 */
export function parseModelId(modelId: string): ParsedModelId | null {
  const parts = modelId.split(MODEL_ID_SEPARATOR);
  if (parts.length < 3 || parts[0] !== MODEL_ID_PREFIX) return null;

  const cli = parts[1] as CliType;
  if (cli !== "gemini" && cli !== "codex" && cli !== "claude") return null;

  // backend model ID에 ':'가 포함될 수 있으므로 나머지를 합침
  const backendModel = parts.slice(2).join(MODEL_ID_SEPARATOR);
  if (!backendModel) return null;

  return { cli, backendModel };
}

/** CLI + backend model을 `acp:<cli>:<backend-model>` 형식으로 조립 */
export function buildModelId(cli: CliType, backendModel: string): string {
  return `${MODEL_ID_PREFIX}${MODEL_ID_SEPARATOR}${cli}${MODEL_ID_SEPARATOR}${backendModel}`;
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
 * CLI 백엔드에 전달할 시스템 지침을 설정한다.
 * 외부 확장(admiral 등)이 호출하며, provider-stream.ts가
 * 첫 프롬프트 전송 시 context.systemPrompt 대신 이 값을 사용한다.
 * null이면 시스템 지침을 전달하지 않는다.
 */
export function setCliSystemPrompt(prompt: string | null): void {
  (globalThis as Record<symbol, unknown>)[CLI_SYSTEM_PROMPT_KEY] = prompt;
}

/**
 * 현재 설정된 CLI 전용 시스템 지침을 반환한다.
 * 설정되지 않았으면 null을 반환한다.
 */
export function getCliSystemPrompt(): string | null {
  return ((globalThis as Record<symbol, unknown>)[CLI_SYSTEM_PROMPT_KEY] as string | null) ?? null;
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
