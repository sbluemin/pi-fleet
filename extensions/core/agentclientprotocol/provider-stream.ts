/**
 * core/agentclientprotocol/provider-stream — ACP 기반 streamSimple 구현
 *
 * UnifiedAgent provider client를 통해 Gemini/Codex/Claude CLI 백엔드를 pi TUI에 통합.
 * Virtual Tool 방식: ACP CLI가 투명 스트리밍 백엔드. pi tool 루프 우회.
 * 신규 세션 시 pi 대화내역을 XML 구조화 히스토리로 첫 프롬프트에 주입한다.
 * CLI 전용 systemPrompt는 connect options.systemPrompt로 executor에서 직접 주입한다.
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import type {
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  ThinkingBudgets,
  Tool,
} from "@mariozechner/pi-ai";
import crypto from "crypto";
import type { CliType, IUnifiedAgentClient, McpServerConfig, UnifiedClientOptions } from "@sbluemin/unified-agent";
import { UnifiedAgent } from "@sbluemin/unified-agent";

import {
  type ActivePromptState,
  type AcpSessionState,
  type AcpProviderState,
  type PendingToolCallState,
  DEFAULT_PROMPT_IDLE_TIMEOUT,
  DEFAULT_BRIDGE_SCOPE,
  buildModelId,
  clearBridgeScopeSessionBySessionKey,
  clearSessionLaunchConfig,
  setBridgeScopeSession,
  setSessionLaunchConfig,
  parseModelId,
  hashSystemPrompt,
  getOrInitState,
  getCliSystemPrompt,
  getCliRuntimeContext,
} from "./provider-types.js";
import { applyPostConnectConfig } from "./executor.js";
import { createEventMapper } from "./provider-events.js";
import { getLogAPI } from "../log/bridge.js";
import {
  startMcpServer,
  stopMcpServer,
  resolveNextToolCall,
  clearPendingForSession,
  setOnToolCallArrived,
  type McpCallToolResult,
} from "./provider-mcp.js";
import {
  registerToolsForSession,
  removeToolsForSession,
  clearAllTools,
  computeToolHash,
  getToolNamesForSession,
} from "./provider-tools.js";
import { getSessionStore, onHostSessionChange } from "./runtime.js";
import { classifyResumeFailure, isDeadSessionError } from "./session-resume-utils.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

interface StreamOptionsLike extends SimpleStreamOptions {
  cwd?: string;
  sessionId?: string;
  piSessionId?: string;
  conversationId?: string;
}

interface ToolResultEnvelope {
  content: unknown;
  isError?: boolean;
  toolCallId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_KEY_PREFIX = "acp";
const SESSION_SCOPE_PREFIX = "session";
const TRANSPORT_RECOVERY_PATTERNS = [
  /ACP connection closed/i,
  /connection closed/i,
  /broken pipe/i,
  /EPIPE/i,
  /ECONNRESET/i,
  /disconnect/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

/** 디버그 로깅 — log 시스템 사용 */
function debug(...args: unknown[]): void {
  const log = getLogAPI();
  log.debug("acp-provider", args.map(String).join(" "), { category: "acp" });
}

/** finalPrompt 원문을 파일 로그에 남긴다. Footer에는 노출하지 않는다. */
function logFinalPrompt(
  cli: CliType,
  backendModel: string,
  session: AcpSessionState,
  prompt: string,
): void {
  const log = getLogAPI();
  const phase = session.firstPromptSent ? "follow-up" : "initial";
  const sessionId = session.sessionId ?? "unknown";
  log.debug(
    "acp-provider",
    [
      `ACP finalPrompt [${phase}] cli=${cli} model=${backendModel} session=${sessionId} scope=${session.scopeKey}`,
      "----- BEGIN FINAL PROMPT -----",
      prompt,
      "----- END FINAL PROMPT -----",
    ].join("\n"),
    { hideFromFooter: true, category: "acp" },
  );
}

/** 에러 메시지 추출 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    try { return JSON.stringify(err); } catch { /* noop */ }
  }
  return String(err);
}

function isRecoverablePromptFailure(err: unknown): boolean {
  const message = errorMessage(err);
  return isDeadSessionError(err) ||
    TRANSPORT_RECOVERY_PATTERNS.some((pattern) => pattern.test(message));
}

function createActivePromptState(sessionGeneration: number): ActivePromptState {
  return {
    promptId: crypto.randomUUID(),
    sessionGeneration,
    retryConsumed: false,
    assistantOutputStarted: false,
    builtinToolStarted: false,
    mcpToolUseStarted: false,
  };
}

function isCurrentActivePrompt(
  session: AcpSessionState,
  promptId: string,
  sessionGeneration: number,
): boolean {
  return session.activePrompt?.promptId === promptId &&
    session.activePrompt.sessionGeneration === sessionGeneration;
}

function markAssistantOutputStarted(session: AcpSessionState): void {
  if (session.activePrompt) {
    session.activePrompt.assistantOutputStarted = true;
  }
}

function markBuiltinToolStarted(session: AcpSessionState): void {
  if (session.activePrompt) {
    session.activePrompt.builtinToolStarted = true;
  }
}

function markMcpToolUseStarted(session: AcpSessionState): void {
  if (session.activePrompt) {
    session.activePrompt.mcpToolUseStarted = true;
  }
}

function canRetryDeadSession(session: AcpSessionState): boolean {
  const prompt = session.activePrompt;
  if (!prompt) {
    return false;
  }
  return !prompt.retryConsumed &&
    !prompt.assistantOutputStarted &&
    !prompt.builtinToolStarted &&
    !prompt.mcpToolUseStarted;
}

/** context에서 마지막 user 메시지 텍스트 추출 */
function extractLatestUserMessage(context: Context): string | null {
  const last = context.messages[context.messages.length - 1];
  if (!last || last.role !== "user") return null;
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    const texts: string[] = [];
    for (const block of last.content) {
      if (block.type === "text" && block.text) texts.push(block.text);
    }
    return texts.join("\n") || null;
  }
  return null;
}

/** 메시지 content에서 텍스트 추출 (string | ContentBlock[]) */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) texts.push(block.text);
    }
    return texts.join("\n");
  }
  return "";
}

/**
 * PI SimpleStreamOptions의 reasoning/thinkingBudgets를 ACP effort/budgetTokens로 변환.
 * PI "minimal" → ACP "none" 매핑. ThinkingBudgets에 "xhigh" 키가 없으므로 "high"로 폴백.
 */
function resolveEffortFromOptions(
  options?: SimpleStreamOptions,
): { effort?: string; budgetTokens?: number } | undefined {
  const reasoning = options?.reasoning;
  if (!reasoning) return undefined;

  const effort = reasoning === "minimal" ? "none" : reasoning;

  let budgetTokens: number | undefined;
  if (options?.thinkingBudgets) {
    const budgetKey: keyof ThinkingBudgets = reasoning === "xhigh" ? "high" : reasoning;
    budgetTokens = options.thinkingBudgets[budgetKey];
  }

  return { effort, budgetTokens };
}

/**
 * 신규 세션의 첫 프롬프트용 XML 구조화 프롬프트 생성.
 * 대화 히스토리(user/assistant) + 런타임 컨텍스트로 래핑된 현재 사용자 요청을 조립한다.
 * 사용자 요청은 항상 마지막에 위치.
 *
 * context.systemPrompt(pi의 시스템 프롬프트)는 사용하지 않는다.
 * CLI 전용 시스템 지침은 executor.buildConnectOptions에서
 * unified-agent connect options.systemPrompt로 직접 전달한다.
 */
function buildInitialPrompt(context: Context, currentUserMessage: string): string {
  const parts: string[] = [];

  // 대화 히스토리 — 마지막 user 메시지 제외, user/assistant만 포함
  const historyMessages = context.messages.slice(0, -1);
  const historyParts: string[] = [];
  for (const msg of historyMessages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = extractMessageText(msg.content);
    if (!text) continue;
    historyParts.push(`<message role="${msg.role}">\n${text}\n</message>`);
  }

  if (historyParts.length > 0) {
    parts.push(`<conversation-history>\n${historyParts.join("\n")}\n</conversation-history>`);
  }

  // CLI 전용 시스템 지침은 executor.buildConnectOptions에서 connect 시점에 주입된다.
  // 이 지점의 user-turn XML 주입은 더 이상 필요하지 않다.

  // initial과 follow-up 두 경로에서 동일한 런타임 컨텍스트가 주입되도록 builder를 경유한다.
  // builder 미등록 시에는 기존 <user_request> 래핑으로 fallback한다.
  const builder = getCliRuntimeContext();
  const userBlock = builder
    ? builder(currentUserMessage)
    : `<user_request>\n${currentUserMessage}\n</user_request>`;

  // 현재 사용자 요청 — 항상 마지막. 후속 턴의 builder 출력과 태그명 일치.
  parts.push(userBlock);

  return parts.join("\n\n");
}

/** stream 옵션에서 provider scope 키 추출 */
function getSessionScopeKey(options: StreamOptionsLike | undefined, cwd: string): string {
  if (options?.sessionId) {
    return `${SESSION_SCOPE_PREFIX}:pi:${options.sessionId}`;
  }
  if (options?.piSessionId) {
    return `${SESSION_SCOPE_PREFIX}:pi-session:${options.piSessionId}`;
  }
  if (options?.conversationId) {
    return `${SESSION_SCOPE_PREFIX}:conversation:${options.conversationId}`;
  }
  throw new Error(`ACP 세션 스코프 식별자가 없습니다 (cwd fallback 금지): ${cwd}`);
}

/** streamSimple 옵션에서 SessionMapStore가 사용할 PI 세션 파일 키를 추출 */
function getStoreBindingSessionId(options: StreamOptionsLike | undefined): string | undefined {
  return options?.piSessionId ?? options?.sessionId ?? options?.conversationId;
}

/** provider 세션 키 생성 — cwd 단독 키를 금지하고 cli를 항상 포함 */
function getSessionKey(cli: CliType, scopeKey: string): string {
  return `${SESSION_KEY_PREFIX}:${cli}:${scopeKey}`;
}

/** PI 세션 파일 내부의 host/provider 세션 키 */
function getHostSessionStoreKey(cli: CliType, _scopeKey: string): string {
  return `host:${cli}`;
}

/** scope 키로 기존 세션 조회 */
function getSessionByScope(
  state: AcpProviderState,
  cli: CliType,
  scopeKey: string,
): AcpSessionState | undefined {
  const sessionKey = getSessionKey(cli, scopeKey);
  const session = state.sessions.get(sessionKey);
  if (!session) return undefined;
  return session.cli === cli ? session : undefined;
}

/** session을 provider 상태에 등록/갱신 */
function registerSession(
  state: AcpProviderState,
  session: AcpSessionState,
): void {
  state.sessions.set(session.sessionKey, session);
  let scopeSessions = state.sessionKeysByScope.get(session.scopeKey);
  if (!scopeSessions) {
    scopeSessions = new Set();
    state.sessionKeysByScope.set(session.scopeKey, scopeSessions);
  }
  scopeSessions.add(session.sessionKey);
}

/** session의 toolCall 라우팅 상태를 정리 */
function clearSessionRoutingState(
  state: AcpProviderState,
  session: AcpSessionState,
): void {
  for (const pending of session.pendingToolCalls) {
    state.toolCallToSessionKey.delete(pending.toolCallId);
  }
  session.pendingToolCalls = [];
  session.pendingToolCallNotifier = null;
}

/** 세션 수명 종료 시 MCP router를 분리한다 */
function detachToolCallRouter(session: AcpSessionState): void {
  if (!session.mcpSessionToken) return;
  setOnToolCallArrived(session.mcpSessionToken, null);
}

/** 논리적 prompt 종료 시 router와 orphaned MCP 상태를 함께 정리한다 */
function closeLogicalPromptRouting(
  state: AcpProviderState,
  session: AcpSessionState,
): void {
  if (session.mcpSessionToken) {
    detachToolCallRouter(session);
    clearPendingForSession(session.mcpSessionToken);
  }
  clearSessionRoutingState(state, session);
}

/** session을 provider 상태에서 제거 */
function removeSession(
  state: AcpProviderState,
  session: AcpSessionState,
): void {
  clearSessionRoutingState(state, session);
  clearBridgeScopeSessionBySessionKey(session.sessionKey);
  clearSessionLaunchConfig(session.sessionKey);
  const scopeSessions = state.sessionKeysByScope.get(session.scopeKey);
  scopeSessions?.delete(session.sessionKey);
  if (scopeSessions && scopeSessions.size === 0) {
    state.sessionKeysByScope.delete(session.scopeKey);
  }
  state.sessions.delete(session.sessionKey);
}

/** MCP toolCallId를 세션 FIFO에 등록 */
function registerPendingToolCall(
  state: AcpProviderState,
  session: AcpSessionState,
  toolName: string,
  args: Record<string, unknown>,
): PendingToolCallState {
  const toolCallId = crypto.randomUUID();
  const pending: PendingToolCallState = {
    toolCallId,
    toolName,
    args,
    emitted: false,
  };
  session.pendingToolCalls.push(pending);
  state.toolCallToSessionKey.set(toolCallId, session.sessionKey);
  return pending;
}

/** FIFO head의 toolCallId를 세션에서 소비 */
function consumePendingToolCall(
  state: AcpProviderState,
  session: AcpSessionState,
  toolCallId: string,
): void {
  const head = session.pendingToolCalls[0];
  if (!head || head.toolCallId !== toolCallId) {
    throw new Error(
      `pending MCP head mismatch: expected=${head?.toolCallId ?? "none"} actual=${toolCallId}`,
    );
  }
  session.pendingToolCalls.shift();
  state.toolCallToSessionKey.delete(toolCallId);
}

/** 현재 세션의 pending FIFO head 조회 */
function getPendingToolCallHead(session: AcpSessionState): PendingToolCallState | undefined {
  return session.pendingToolCalls[0];
}

/** 현재 turn에서 아직 emit되지 않은 head MCP call을 pi로 전달 */
function emitNextPendingToolCall(
  mapper: ReturnType<typeof createEventMapper>,
  session: AcpSessionState,
): boolean {
  const head = getPendingToolCallHead(session);
  if (!head || head.emitted) return false;
  const emitted = mapper.emitMcpToolCall(head.toolName, head.args, head.toolCallId);
  if (emitted) {
    head.emitted = true;
  }
  return emitted;
}

/** 세션 수명 동안 유지되는 MCP tool router 설치 */
function installToolCallRouter(
  state: AcpProviderState,
  session: AcpSessionState,
): void {
  if (!session.mcpSessionToken) return;
  setOnToolCallArrived(session.mcpSessionToken, (toolName, args) => {
    const pending = registerPendingToolCall(state, session, toolName, args);
    session.pendingToolCallNotifier?.();
    return pending.toolCallId;
  });
}

/** toolResult 묶음이 가리키는 원본 ACP 세션 조회 */
function resolveToolResultSession(
  state: AcpProviderState,
  toolResults: ToolResultEnvelope[],
): AcpSessionState | null {
  let resolvedSession: AcpSessionState | null = null;
  for (const result of toolResults) {
    if (!result.toolCallId) {
      return null;
    }
    const sessionKey = state.toolCallToSessionKey.get(result.toolCallId);
    if (!sessionKey) {
      return null;
    }
    const session = state.sessions.get(sessionKey);
    if (!session) {
      return null;
    }
    if (!resolvedSession) {
      resolvedSession = session;
      continue;
    }
    if (resolvedSession.sessionKey !== session.sessionKey) {
      throw new Error("서로 다른 ACP 세션의 toolResult가 한 턴에 섞였습니다");
    }
  }
  return resolvedSession;
}

/**
 * 세션 상태를 가져오거나 새로 생성.
 * systemPrompt drift 감지 시 기존 세션 폐기.
 * CLI 변경 시 기존 세션 폐기.
 */
async function ensureSession(
  cli: CliType,
  backendModel: string,
  scopeKey: string,
  cwd: string,
  systemPromptHash: string,
  tools?: Tool[],
  effortOverrides?: { effort?: string; budgetTokens?: number },
): Promise<AcpSessionState> {
  const state = getOrInitState();
  const key = getSessionKey(cli, scopeKey);
  let session = getSessionByScope(state, cli, scopeKey);

  // tool hash 계산
  const currentToolHash = tools && tools.length > 0 ? computeToolHash(tools) : undefined;

  // CLI 변경, systemPrompt drift, tool hash 변경 — 기존 세션 폐기
  // 단, 복원된 세션(client=null, sessionId존재)에서는 systemPrompt drift 무시
  // — resume 시 pi가 systemPrompt를 새로 생성하므로 hash가 달라질 수 있음
  if (session) {
    const cliChanged = session.cli !== cli;
    const isRestoredSession = !session.client && !!session.sessionId;
    const promptDrifted = !isRestoredSession &&
      session.lastSystemPromptHash &&
      session.lastSystemPromptHash !== systemPromptHash;
    const toolsChanged = session.toolHash && currentToolHash &&
      session.toolHash !== currentToolHash;
    const deadClient = !!session.client && !isProviderClientAlive(session.client);
    const needsRecovery = session.needsRecovery || deadClient;

    if (cliChanged || promptDrifted || toolsChanged || needsRecovery) {
      const reason = cliChanged
        ? "CLI 변경"
        : promptDrifted
          ? "systemPrompt drift"
          : toolsChanged
            ? "tool 목록 변경"
            : deadClient
              ? "dead client 감지"
              : "dead-session recovery";
      debug(`세션 폐기: ${reason}`, `(${session.cli} → ${cli})`);
      await session.client?.disconnect().catch(() => {});
      session.client = null;
      if (session.mcpSessionToken) {
        clearPendingForSession(session.mcpSessionToken);
        removeToolsForSession(session.mcpSessionToken);
        detachToolCallRouter(session);
      }
      removeSession(state, session);
      session = undefined;
    }
  }

  // 기존 세션이 유효하면 재사용 — 모델 변경 시 setModel 호출
  if (session?.client && session.sessionId) {
    if (session.currentModel !== backendModel) {
      debug(`모델 변경 감지: ${session.currentModel} → ${backendModel}`);
      try {
        await session.client.setModel(backendModel);
        session.currentModel = backendModel;
        debug(`setModel 성공: ${backendModel}`);
      } catch (err) {
        // setModel 실패 — 세션 폐기 후 재생성으로 fallback
        debug(`setModel 실패, 세션 재생성으로 fallback:`, errorMessage(err));
        await disconnectSession(session);
        removeSession(state, session);
        session = undefined;
      }
    }
    if (session) {
      if (effortOverrides?.effort || effortOverrides?.budgetTokens) {
        await applyPostConnectConfig(session.client!, session.cli, effortOverrides);
      }
      installToolCallRouter(state, session);
      session.needsRecovery = false;
      session.lastError = null;
      setSessionLaunchConfig(session.sessionKey, {
        modelId: buildModelId(cli, session.currentModel),
        ...(effortOverrides?.effort ? { effort: effortOverrides.effort } : {}),
        ...(effortOverrides?.budgetTokens ? { budgetTokens: effortOverrides.budgetTokens } : {}),
      });
      debug(`기존 세션 재사용: ${session.sessionId!.slice(0, 8)}`);
      return session;
    }
  }

  // ── MCP 서버 기동 + tool 등록 ──
  const sessionToken = crypto.randomUUID();
  let mcpServers: McpServerConfig[] | undefined;
  let mcpActive = false;

  if (tools && tools.length > 0) {
    try {
      const mcpUrl = await startMcpServer();
      registerToolsForSession(sessionToken, tools);
      mcpServers = [{
        type: "http",
        url: mcpUrl,
        headers: [{ name: "Authorization", value: `Bearer ${sessionToken}` }],
        name: "pi-tools",
        toolTimeout: 1800,
      }];
      mcpActive = true;
      debug(`MCP 활성화: ${tools.length}개 tool, token=${sessionToken.slice(0, 8)}`);
    } catch (err) {
      debug(`MCP 서버 기동 실패, fallback:`, errorMessage(err));
    }
  }

  // 새 세션 생성
  const newSession: AcpSessionState = {
    sessionKey: key,
    scopeKey,
    client: null,
    sessionId: null,
    cwd,
    lastSystemPromptHash: systemPromptHash,
    cli,
    firstPromptSent: false,
    currentModel: backendModel,
    mcpSessionToken: mcpActive ? sessionToken : undefined,
    toolHash: currentToolHash,
    pendingToolCalls: [],
    pendingToolCallNotifier: null,
    activePrompt: null,
    sessionGeneration: (session?.sessionGeneration ?? -1) + 1,
    needsRecovery: false,
    lastError: null,
  };

  const store = getSessionStore();
  const storeKey = getHostSessionStoreKey(cli, scopeKey);
  const savedSessionId = store.get(storeKey) ?? undefined;
  let client: IUnifiedAgentClient | null = null;
  let resumedFromSavedSession = false;

  try {
    debug(savedSessionId ? `session/load 복원 시도: ${savedSessionId.slice(0, 8)}` : `새 연결 시작: cli=${cli}`);
    // Admiral host 응답 생성 경로는 전역 systemPrompt를 connect 옵션으로 직접 전달한다.
    client = await UnifiedAgent.build({ cli, sessionId: savedSessionId });
    let connectResult;
    try {
      connectResult = await client.connect(buildProviderConnectOptions(
        cli,
        cwd,
        backendModel,
        mcpServers,
        savedSessionId,
      ));
      resumedFromSavedSession = !!savedSessionId;
    } catch (connectError) {
      if (!savedSessionId) {
        throw connectError;
      }
      if (classifyResumeFailure(connectError) !== "dead-session") {
        throw connectError;
      }

      debug(`session/load 실패, fresh fallback: ${savedSessionId.slice(0, 8)} ${errorMessage(connectError)}`);
      store.clear(storeKey);
      await client.disconnect().catch(() => {});
      client.removeAllListeners();
      client = await UnifiedAgent.build({ cli });
      resumedFromSavedSession = false;
      connectResult = await client.connect(buildProviderConnectOptions(
        cli,
        cwd,
        backendModel,
        mcpServers,
      ));
    }
    await applyPostConnectConfig(client, cli, effortOverrides);
    newSession.client = client;
    newSession.sessionId = connectResult.session?.sessionId ?? client.getConnectionInfo().sessionId ?? null;
    newSession.firstPromptSent = resumedFromSavedSession;
    if (newSession.sessionId) {
      store.set(storeKey, newSession.sessionId);
    }
    registerSession(state, newSession);
    installToolCallRouter(state, newSession);
    setSessionLaunchConfig(newSession.sessionKey, {
      modelId: buildModelId(cli, backendModel),
      ...(effortOverrides?.effort ? { effort: effortOverrides.effort } : {}),
      ...(effortOverrides?.budgetTokens ? { budgetTokens: effortOverrides.budgetTokens } : {}),
    });
    if (newSession.sessionId) {
      debug(`세션 생성 완료: ${newSession.sessionId.slice(0, 8)}`);
    }
    return newSession;
  } catch (err) {
    // 실패 시 정리
    await (client ?? newSession.client)?.disconnect().catch(() => {});
    (client ?? newSession.client)?.removeAllListeners();
    if (mcpActive) removeToolsForSession(sessionToken);
    throw err;
  }
}

/** 세션 연결 해제 — provider lifecycle 정리는 backend 세션을 archive하지 않는다. */
async function disconnectSession(
  session: AcpSessionState,
  preserveSessionId = false,
): Promise<void> {
  try {
    if (session.client) {
      await session.client.disconnect().catch(() => {});
    }
  } catch {
    // best-effort
  }
  session.client = null;
  if (!preserveSessionId) {
    session.sessionId = null;
  }
  // MCP tool registry 정리
  if (session.mcpSessionToken) {
    clearPendingForSession(session.mcpSessionToken);
    removeToolsForSession(session.mcpSessionToken);
    detachToolCallRouter(session);
    session.mcpSessionToken = undefined;
  }
  session.pendingToolCallNotifier = null;
}

/** 현재 ACP turn의 listener/abort 수명주기 관리 */
function createTurnCleanup(
  state: AcpProviderState,
  session: AcpSessionState,
  mapper: ReturnType<typeof createEventMapper>,
  removeListeners: () => void,
  cleanupAbort: () => void,
): () => void {
  let cleaned = false;

  return (): void => {
    if (cleaned) return;
    cleaned = true;
    removeListeners();
    cleanupAbort();
    if (mapper.output.stopReason !== "toolUse") {
      closeLogicalPromptRouting(state, session);
      session.activePrompt = null;
    }
  };
}

/** mapper 종료 지점(toolUse 포함)에 turn cleanup을 연결 */
function attachTurnCleanup(
  state: AcpProviderState,
  session: AcpSessionState,
  mapper: ReturnType<typeof createEventMapper>,
  removeListeners: () => void,
  cleanupAbort: () => void,
): void {
  const cleanup = createTurnCleanup(state, session, mapper, removeListeners, cleanupAbort);
  const originalFinishDone = mapper.finishDone;
  const originalFinishWithError = mapper.finishWithError;
  const originalEmitMcpToolCall = mapper.emitMcpToolCall;

  mapper.finishDone = (): void => {
    originalFinishDone();
    cleanup();
  };

  mapper.finishWithError = (reason: "aborted" | "error", message: string): void => {
    originalFinishWithError(reason, message);
    cleanup();
  };

  mapper.emitMcpToolCall = (toolName: string, args: Record<string, unknown>, toolCallId: string): boolean => {
    const emitted = originalEmitMcpToolCall(toolName, args, toolCallId);
    if (emitted) {
      cleanup();
    }
    return emitted;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// streamAcp — provider 진입점
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Provider 진입점 — pi의 streamSimple 계약 구현.
 *
 * 두 가지 모드:
 * Case 1 (fresh query): sendMessage() 호출, MCP tool call 시 done="toolUse"로 pi에 양보
 * Case 2 (tool result delivery): pi가 tool 실행 완료 후 재호출, FIFO 큐 resolve
 */
export function streamAcp(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const parsed = parseModelId(model.id);
  if (!parsed) {
    const mapper = createEventMapper(model.id, "");
    queueMicrotask(() => {
      mapper.finishWithError("error", `잘못된 ACP model ID: ${model.id}`);
    });
    return mapper.stream;
  }

  const { cli, backendModel } = parsed;
  const streamOptions = options as StreamOptionsLike | undefined;
  const cwd = streamOptions?.cwd ?? process.cwd();
  let scopeKey: string;
  try {
    scopeKey = getSessionScopeKey(streamOptions, cwd);
  } catch (err) {
    const errorMapper = createEventMapper(model.id, "");
    queueMicrotask(() => {
      errorMapper.finishWithError("error", errorMessage(err));
    });
    return errorMapper.stream;
  }
  const storeBindingSessionId = getStoreBindingSessionId(streamOptions);
  if (storeBindingSessionId) {
    onHostSessionChange(storeBindingSessionId);
  }
  // drift 감지: context.systemPrompt(pi 전체) 대신 CLI 전용 지침 해시 사용
  const systemPromptHash = hashSystemPrompt(getCliSystemPrompt() ?? undefined);
  const state = getOrInitState();
  const toolResults = extractAllToolResults(context);
  const isToolResultDelivery = toolResults.length > 0;
  const toolResultSession = isToolResultDelivery ? resolveToolResultSession(state, toolResults) : null;
  const mapper = createEventMapper(model.id, "", {
    onAssistantOutputStarted: () => {
      const session = toolResultSession ?? getSessionByScope(state, cli, scopeKey);
      if (session) {
        markAssistantOutputStarted(session);
      }
    },
    onBuiltinToolStarted: () => {
      const session = toolResultSession ?? getSessionByScope(state, cli, scopeKey);
      if (session) {
        markBuiltinToolStarted(session);
      }
    },
    onMcpToolUseStarted: () => {
      const session = toolResultSession ?? getSessionByScope(state, cli, scopeKey);
      if (session) {
        markMcpToolUseStarted(session);
      }
    },
  });

  if (isToolResultDelivery) {
    if (!toolResultSession) {
      queueMicrotask(() => {
        mapper.finishWithError(
          "error",
          "toolResult 라우팅 실패: toolCallId로 원본 ACP 세션을 찾을 수 없습니다",
        );
      });
      return mapper.stream;
    }
    // ── Case 2: tool result delivery ──
    runToolResultDelivery(toolResultSession, toolResults, model, options, mapper).catch((err) => {
      debug(`tool result delivery 에러:`, errorMessage(err));
      mapper.finishWithError("error", errorMessage(err));
    });
  } else {
    // ── Case 1: fresh query ──
    runFreshQuery(cli, backendModel, scopeKey, cwd, context, systemPromptHash, model, options, mapper).catch((err) => {
      debug(`streamAcp 치명적 에러:`, errorMessage(err));
      mapper.finishWithError("error", errorMessage(err));
    });
  }

  return mapper.stream;
}

// ═══════════════════════════════════════════════════════════════════════════
// Case 1: Fresh query — sendMessage 호출
// ═══════════════════════════════════════════════════════════════════════════

async function runFreshQuery(
  cli: CliType,
  backendModel: string,
  scopeKey: string,
  cwd: string,
  context: Context,
  systemPromptHash: string,
  _model: Model<any>,
  options: SimpleStreamOptions | undefined,
  mapper: ReturnType<typeof createEventMapper>,
): Promise<void> {
  const state = getOrInitState();
  const key = getSessionKey(cli, scopeKey);

  // 새 prompt 시작 시 논리 프롬프트 상태 초기화
  const existingSession = getSessionByScope(state, cli, scopeKey);
  if (existingSession?.activePrompt) {
    existingSession.activePrompt = null;
  }

  // ── 프롬프트 추출 ──
  let promptText = extractLatestUserMessage(context);
  if (!promptText) {
    // 마지막 메시지가 toolResult인데 Case 1로 온 경우 — 분기 오류
    const lastCtxMsg = context.messages[context.messages.length - 1];
    if (lastCtxMsg?.role === "toolResult") {
      throw new Error(
        "toolResult 메시지가 Case 1(fresh query)로 라우팅됨 — " +
        "Case 2(tool result delivery)로 분기되어야 합니다. " +
        "세션 상태를 확인하세요.",
      );
    }
    debug("WARNING: empty prompt — fallback to Continue.");
    promptText = "Continue.";
  }

  // ── 세션 확보 ──
  const effortOverrides = resolveEffortFromOptions(options);
  let session: AcpSessionState;
  try {
    session = await ensureSession(cli, backendModel, scopeKey, cwd, systemPromptHash, context.tools, effortOverrides);
  } catch (err) {
    mapper.finishWithError("error", `ACP 연결 실패: ${errorMessage(err)}`);
    return;
  }

  if (!session.client || !session.sessionId) {
    mapper.finishWithError("error", "ACP 세션이 유효하지 않습니다");
    return;
  }

  session.activePrompt = createActivePromptState(session.sessionGeneration);
  session.lastError = null;
  const promptId = session.activePrompt.promptId;
  const promptGeneration = session.activePrompt.sessionGeneration;

  setBridgeScopeSession(DEFAULT_BRIDGE_SCOPE, session.sessionKey);

  // ── 프롬프트 구성 ──
  let finalPrompt = promptText;
  if (!session.firstPromptSent) {
    finalPrompt = buildInitialPrompt(context, promptText);
    debug("XML 구조화 초기 프롬프트 주입 (첫 프롬프트)");
  } else {
    // follow-up 턴: 런타임 컨텍스트 빌더에게 사용자 요청을 전달해 완성된 prefix를 받는다
    // 빌더는 런타임 태그와 `<user_request>` 래핑 등 최종 조립을 직접 수행한다.
    const builder = getCliRuntimeContext();
    if (builder) {
      finalPrompt = builder(promptText);
    }
  }

  // 매퍼 설정
  mapper.setTargetSessionId(session.sessionId);
  if (session.mcpSessionToken) {
    mapper.setPiToolNames(getToolNamesForSession(session.mcpSessionToken));
  }

  // ── 이벤트 리스너 등록 ──
  const client = session.client;
  const removeListeners = wireListeners(client, mapper, session, session.mcpSessionToken);

  // ── abort 핸들링 ──
  const { wasAborted, cleanupAbort } = setupAbortHandling(session, state, mapper, removeListeners, options);
  if (wasAborted.value) return;

  attachTurnCleanup(state, session, mapper, removeListeners, cleanupAbort);

  // ── sendMessage — fire-and-forget ──
  // sendMessage는 promptComplete까지 resolve되지 않음.
  // MCP tool call 시 event-mapper가 done="toolUse"로 스트림 종료.
  // sendMessage는 계속 pending — ACP CLI가 MCP 응답 대기 중이므로 이벤트 없음.
  logFinalPrompt(cli, backendModel, session, finalPrompt);
  debug(`sendMessage: cli=${cli} model=${backendModel} prompt=${finalPrompt.slice(0, 60)}...`);

  client.sendMessage(finalPrompt).then(() => {
    if (!isCurrentActivePrompt(session, promptId, promptGeneration)) {
      debug(`stale prompt 완료 무시: key=${key}`);
      return;
    }
    session.firstPromptSent = true;
    session.lastSystemPromptHash = systemPromptHash;
    session.needsRecovery = false;
    session.lastError = null;
    debug("sendMessage 완료 (promptComplete 처리됨)");
  }).catch((err) => {
    if (wasAborted.value) return;
    const msg = errorMessage(err);
    if (!isCurrentActivePrompt(session, promptId, promptGeneration)) {
      debug(`stale prompt 에러 무시: key=${key} msg=${msg}`);
      return;
    }
    debug(`sendMessage 에러: ${msg}`);
    session.lastError = msg;
    session.needsRecovery = isRecoverablePromptFailure(err);
    if (session.needsRecovery) {
      debug(`dead-session 감지: key=${key}`);
    }
    if (session.activePrompt && canRetryDeadSession(session) && session.needsRecovery) {
      session.activePrompt.retryConsumed = true;
      session.sessionGeneration += 1;
      mapper.finishWithError("error", `ACP 세션이 종료되었습니다. 현재 턴은 자동 재시작하지 않았습니다. 다시 시도해주세요. (${msg})`);
      return;
    }
    // mapper가 아직 finished가 아니면 에러 발행
    mapper.finishWithError("error", `ACP 요청 실패: ${msg}`);
  });

  // 매퍼 스트림이 종료될 때까지 대기 (done="toolUse" 또는 done="stop")
  // 스트림 종료는 mapper 내부에서 처리됨 — 여기서는 기다리지 않음
}

// ═══════════════════════════════════════════════════════════════════════════
// Case 2: Tool result delivery — FIFO 큐 resolve
// ═══════════════════════════════════════════════════════════════════════════

async function runToolResultDelivery(
  session: AcpSessionState,
  toolResults: ToolResultEnvelope[],
  _model: Model<any>,
  options: SimpleStreamOptions | undefined,
  mapper: ReturnType<typeof createEventMapper>,
): Promise<void> {
  const state = getOrInitState();

  if (!session?.client || !session.sessionId || !session.mcpSessionToken) {
    mapper.finishWithError("error", "tool result delivery: 세션이 유효하지 않습니다");
    clearSessionRoutingState(state, session);
    return;
  }

  if (session.needsRecovery || !session.activePrompt || session.activePrompt.mcpToolUseStarted !== true) {
    mapper.finishWithError("error", "이전 toolUse 이후 ACP 세션이 유효하지 않습니다. stale toolResult는 폐기되었고, 새 세션 자동 재개는 수행하지 않습니다. 다시 시도해주세요.");
    closeLogicalPromptRouting(state, session);
    return;
  }

  debug("Case 2: tool result delivery");

  for (const result of toolResults) {
    const head = getPendingToolCallHead(session);
    if (!result.toolCallId || head?.toolCallId !== result.toolCallId) {
      throw new Error("toolResult의 toolCallId가 현재 ACP 세션의 FIFO head와 일치하지 않습니다");
    }
    const mcpResult: McpCallToolResult = {
      content: [],
      isError: result.isError ?? false,
    };

    // toolResult content → MCP content 변환
    if (typeof result.content === "string") {
      mcpResult.content.push({ type: "text", text: result.content });
    } else if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (block.type === "text") {
          mcpResult.content.push({ type: "text", text: block.text ?? "" });
        }
      }
    }
    if (mcpResult.content.length === 0) {
      mcpResult.content.push({ type: "text", text: "(결과 없음)" });
    }

    // FIFO 큐 resolve — MCP HTTP 응답 반환
    resolveNextToolCall(session.mcpSessionToken, result.toolCallId, mcpResult);
    consumePendingToolCall(state, session, result.toolCallId);
    debug(`tool result → MCP resolve 완료`);
  }

  // ── 새 이벤트 매퍼로 ACP 이벤트 계속 수신 ──
  mapper.setTargetSessionId(session.sessionId);
  if (session.mcpSessionToken) {
    mapper.setPiToolNames(getToolNamesForSession(session.mcpSessionToken));
  }

  // 이벤트 리스너 재등록 — ACP CLI가 MCP 응답 받고 계속 처리
  const client = session.client;
  const removeListeners = wireListeners(client, mapper, session, session.mcpSessionToken);

  // abort 핸들링
  const { wasAborted, cleanupAbort } = setupAbortHandling(session, state, mapper, removeListeners, options);
  if (wasAborted.value) return;

  // 매퍼가 done="toolUse" (다음 tool call) 또는 done="stop" (완료)을 emit할 때까지 대기
  // sendMessage()는 Case 1에서 이미 호출되어 pending — 다시 호출하지 않음
  // mapper의 finishDone/finishWithError를 래핑하여 정리 로직 트리거
  // (EventStream에는 .on("end") 없음 — push/end/[Symbol.asyncIterator]만 지원)
  attachTurnCleanup(state, session, mapper, removeListeners, cleanupAbort);

  emitNextPendingToolCall(mapper, session);
}

// ═══════════════════════════════════════════════════════════════════════════
// 공통 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/**
 * abort 핸들링 공통 설정.
 * signal 등록 + abort 시 세션 취소 / FIFO 정리 / 리스너 해제.
 * @returns wasAborted 플래그 참조 + cleanupAbort 함수
 */
function setupAbortHandling(
  session: AcpSessionState,
  state: AcpProviderState,
  mapper: ReturnType<typeof createEventMapper>,
  removeListeners: () => void,
  options?: SimpleStreamOptions,
): { wasAborted: { value: boolean }; cleanupAbort: () => void } {
  const wasAborted = { value: false };

  const onAbort = (): void => {
    wasAborted.value = true;
    debug("abort 신호 수신");
    if (session.client) {
      session.client.cancelPrompt().catch(() => {});
    }
    closeLogicalPromptRouting(state, session);
    mapper.finishWithError("aborted", "Operation aborted");
    removeListeners();
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      onAbort();
      return { wasAborted, cleanupAbort: () => {} };
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
  }

  const cleanupAbort = (): void => {
    if (options?.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }
  };

  return { wasAborted, cleanupAbort };
}

/** Unified Agent provider client에 이벤트 리스너 등록 — 해제 함수 반환 */
function wireListeners(
  client: IUnifiedAgentClient,
  mapper: ReturnType<typeof createEventMapper>,
  session: AcpSessionState,
  mcpToken?: string,
): () => void {
  const { listeners } = mapper;
  const log = getLogAPI();
  const onLogEntry = (entry: { message: string; cli?: string; sessionId?: string }) => {
    const stripped = entry.message.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!stripped || /^[\|\/\\\-⠁-⣿\.\s]+$/.test(stripped)) {
      return;
    }
    log.debug(
      "acp-provider",
      [entry.cli ? `cli=${entry.cli}` : null, entry.sessionId ? `session=${entry.sessionId}` : null, stripped]
        .filter(Boolean)
        .join(" "),
      { category: "acp-stderr", hideFromFooter: true },
    );
  };

  client.on("messageChunk", listeners.onMessageChunk);
  client.on("thoughtChunk", listeners.onThoughtChunk);
  client.on("toolCall", listeners.onToolCall);
  client.on("toolCallUpdate", listeners.onToolCallUpdate);
  client.on("promptComplete", listeners.onPromptComplete);
  client.on("error", listeners.onError);
  client.on("exit", listeners.onExit);
  client.on("logEntry", onLogEntry as never);

  // 현재 turn에서만 flush notifier를 연결
  if (mcpToken) {
    session.pendingToolCallNotifier = () => {
      emitNextPendingToolCall(mapper, session);
    };
  }

  return (): void => {
    client.off("messageChunk", listeners.onMessageChunk);
    client.off("thoughtChunk", listeners.onThoughtChunk);
    client.off("toolCall", listeners.onToolCall);
    client.off("toolCallUpdate", listeners.onToolCallUpdate);
    client.off("promptComplete", listeners.onPromptComplete);
    client.off("error", listeners.onError);
    client.off("exit", listeners.onExit);
    client.off("logEntry", onLogEntry as never);
    if (mcpToken && session.pendingToolCallNotifier) {
      session.pendingToolCallNotifier = null;
    }
  };
}

/** context.messages에서 모든 toolResult 추출 (끝에서부터 연속) */
function extractAllToolResults(
  context: Context,
): ToolResultEnvelope[] {
  const results: ToolResultEnvelope[] = [];
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const msg = context.messages[i];
    if (msg.role === "toolResult") {
      results.unshift({
        content: msg.content,
        isError: (msg as any).isError,
        toolCallId: (msg as any).toolCallId,
      });
    } else {
      break; // 연속된 toolResult만 추출
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Session lifecycle — register.ts에서 호출
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 모든 ACP 세션 정리.
 * session_shutdown 이벤트에서 호출.
 */
export async function cleanupAll(): Promise<void> {
  const state = getOrInitState();

  await clearSessionsAndPreSpawn(state);

  // MCP 서버 종료
  await stopMcpServer();

  debug("cleanupAll 완료");
}

/**
 * session_start 이벤트 처리.
 * 모든 reason에서 기존 세션 정리 — 새 연결 시 히스토리로 컨텍스트 전달.
 */
export async function handleSessionStart(
  reason: "new" | "resume" | "fork",
  piSessionId?: string,
): Promise<void> {
  const state = getOrInitState();

  // live process artifacts는 항상 재생성한다. 디스크 session-map은 runtime의 piSessionId 바인딩을 보존한다.
  await clearSessionsAndPreSpawn(state);
  debug(`session_start(${reason}): 세션 + MCP 초기화`, piSessionId ? `piSessionId=${piSessionId}` : "piSessionId=unknown");
}

/** 세션, MCP tool registry, toolCall 라우팅 상태 일괄 정리 */
async function clearSessionsAndPreSpawn(state: AcpProviderState): Promise<void> {
  for (const session of state.sessions.values()) {
    clearSessionRoutingState(state, session);
    await disconnectSession(session);
    clearBridgeScopeSessionBySessionKey(session.sessionKey);
    clearSessionLaunchConfig(session.sessionKey);
  }
  state.sessions.clear();
  state.sessionKeysByScope.clear();
  state.toolCallToSessionKey.clear();
  state.bridgeScopeSessionKeys.clear();
  state.sessionLaunchConfigs.clear();
  clearAllTools();
}

function buildProviderConnectOptions(
  cli: CliType,
  cwd: string,
  backendModel: string,
  mcpServers?: McpServerConfig[],
  sessionId?: string,
): UnifiedClientOptions {
  const connectOptions: UnifiedClientOptions = {
    cwd,
    cli,
    model: backendModel,
    autoApprove: true,
    clientInfo: { name: "pi-unified-agent-provider", version: "1.0.0" },
    timeout: 0,
    yoloMode: true,
    env: { MCP_TOOL_TIMEOUT: "1800000" },
    promptIdleTimeout: DEFAULT_PROMPT_IDLE_TIMEOUT,
  };

  const systemPrompt = getCliSystemPrompt();
  if (systemPrompt) {
    connectOptions.systemPrompt = systemPrompt;
  }

  if (mcpServers) {
    connectOptions.mcpServers = mcpServers;
  }

  if (sessionId) {
    connectOptions.sessionId = sessionId;
  }

  return connectOptions;
}

function isProviderClientAlive(client: IUnifiedAgentClient): boolean {
  const info = client.getConnectionInfo();
  return info.state === "ready" || info.state === "connected";
}
