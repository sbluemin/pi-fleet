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
  /** sendPrompt idle timeout 등으로 reject된 경우 true — activeSessionKey 보존을 위한 플래그 */
  sendPromptError?: boolean;
}

/** provider 전역 상태 — globalThis에 저장 */
export interface AcpProviderState {
  /** pi session 키 → ACP 세션 상태 맵 */
  sessions: Map<string, AcpSessionState>;
  /** 활성 sendPrompt가 진행 중인 세션 키 — tool result delivery 감지용 */
  activeSessionKey: string | null;
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

/** ACP 연결 기본 타임아웃 (ms) */
export const DEFAULT_REQUEST_TIMEOUT = 600_000; // 10분

/** ACP 초기화 기본 타임아웃 (ms) */
export const DEFAULT_INIT_TIMEOUT = 60_000; // 60초

/** ACP 프롬프트 유휴 타임아웃 (ms) */
export const DEFAULT_PROMPT_IDLE_TIMEOUT = 600_000; // 10분

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
    activeSessionKey: null,
  };
}
