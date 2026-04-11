/**
 * core/agentclientprotocol/provider-stream — ACP 기반 streamSimple 구현
 *
 * UnifiedAgentClient를 통해 Gemini/Codex/Claude CLI 백엔드를 pi TUI에 통합.
 * Virtual Tool 방식: ACP CLI가 투명 스트리밍 백엔드. pi tool 루프 우회.
 * 신규 세션 시 pi 대화내역을 XML 구조화 히스토리로 첫 프롬프트에 주입.
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import type {
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  Tool,
} from "@mariozechner/pi-ai";
import crypto from "crypto";
import { UnifiedAgentClient } from "@sbluemin/unified-agent";
import type { CliType, AcpMcpServer } from "@sbluemin/unified-agent";

import {
  type AcpSessionState,
  type AcpProviderState,
  type PendingToolCallState,
  DEFAULT_PROMPT_IDLE_TIMEOUT,
  parseModelId,
  hashSystemPrompt,
  getOrInitState,
} from "./provider-types.js";
import { acquireSession, releaseSession } from "./executor.js";
import { createEventMapper } from "./provider-events.js";
import { getLogAPI } from "../log/bridge.js";
import {
  startMcpServer,
  stopMcpServer,
  resolveNextToolCall,
  clearPendingForSession,
  setOnToolCallArrived,
  setToolCallAcceptance,
  type McpCallToolResult,
} from "./provider-mcp.js";
import {
  registerToolsForSession,
  removeToolsForSession,
  clearAllTools,
  computeToolHash,
  getToolNamesForSession,
} from "./provider-tools.js";

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

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

/** 디버그 로깅 — log 시스템 사용 */
function debug(...args: unknown[]): void {
  const log = getLogAPI();
  log.debug("acp-provider", args.map(String).join(" "));
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
 * 신규 세션의 첫 프롬프트용 XML 구조화 프롬프트 생성.
 * systemPrompt + 대화 히스토리(user/assistant) + 현재 사용자 요청을 XML 태그로 구조화.
 * 사용자 요청은 항상 마지막에 위치.
 */
function buildInitialPrompt(context: Context, currentUserMessage: string): string {
  const parts: string[] = [];

  // systemPrompt
  if (context.systemPrompt) {
    parts.push(`<system-instructions>\n${context.systemPrompt}\n</system-instructions>`);
  }

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

  // 현재 사용자 요청 — 항상 마지막
  parts.push(`<user-request>\n${currentUserMessage}\n</user-request>`);

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

/** provider 세션 키 생성 — cwd 단독 키를 금지하고 cli를 항상 포함 */
function getSessionKey(cli: CliType, scopeKey: string): string {
  return `${SESSION_KEY_PREFIX}:${cli}:${scopeKey}`;
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
  session.turnActive = false;
  if (session.mcpSessionToken) {
    setToolCallAcceptance(session.mcpSessionToken, false);
  }
}

/** session을 provider 상태에서 제거 */
function removeSession(
  state: AcpProviderState,
  session: AcpSessionState,
): void {
  clearSessionRoutingState(state, session);
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
  session.turnActive = true;
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
  setToolCallAcceptance(session.mcpSessionToken, false);
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

    if (cliChanged || promptDrifted || toolsChanged) {
      debug(
        `세션 폐기: ${cliChanged ? "CLI 변경" : promptDrifted ? "systemPrompt drift" : "tool 목록 변경"}`,
        `(${session.cli} → ${cli})`,
      );
      await session.client?.endSession().catch(() => {});
      await session.client?.disconnect().catch(() => {});
      releaseSession(session.sessionKey);
      session.client = null;
      if (session.mcpSessionToken) {
        clearPendingForSession(session.mcpSessionToken);
        removeToolsForSession(session.mcpSessionToken);
        setOnToolCallArrived(session.mcpSessionToken, null);
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
        releaseSession(session.sessionKey);
        removeSession(state, session);
        session = undefined;
      }
    }
    if (session) {
      installToolCallRouter(state, session);
      debug(`기존 세션 재사용: ${session.sessionId!.slice(0, 8)}`);
      return session;
    }
  }

  // ── MCP 서버 기동 + tool 등록 ──
  const sessionToken = crypto.randomUUID();
  let mcpServers: AcpMcpServer[] | undefined;
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
      } as unknown as AcpMcpServer];
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
    turnActive: false,
    pendingToolCalls: [],
    pendingToolCallNotifier: null,
  };

  try {
    debug(session?.sessionId ? `session/load 복원 시도: ${session.sessionId.slice(0, 8)}` : `새 연결 시작: cli=${cli}`);
    const acquired = await acquireSession({
      key,
      cliType: cli,
      cwd,
      model: backendModel,
      mcpServers,
      yoloMode: true,
      env: { MCP_TOOL_TIMEOUT: '1800000' },
      promptIdleTimeout: DEFAULT_PROMPT_IDLE_TIMEOUT,
    });
    newSession.client = acquired.client;
    newSession.sessionId = acquired.sessionId || acquired.connectionInfo.sessionId || null;
    registerSession(state, newSession);
    installToolCallRouter(state, newSession);
    acquired.release();
    if (newSession.sessionId) {
      debug(`세션 생성 완료: ${newSession.sessionId.slice(0, 8)}`);
    }
    return newSession;
  } catch (err) {
    // 실패 시 정리
    if (mcpActive) removeToolsForSession(sessionToken);
    releaseSession(key);
    if (session?.sessionId) {
      debug(`session/load 실패, 새 세션으로 fallback: ${errorMessage(err)}`);
      session.sessionId = null;
      return ensureSession(cli, backendModel, scopeKey, cwd, systemPromptHash, tools);
    }
    throw err;
  }
}

/** 세션 연결 해제 — preserveSessionId가 true이면 sessionId를 보존 (resume용) */
async function disconnectSession(
  session: AcpSessionState,
  preserveSessionId = false,
): Promise<void> {
  try {
    if (session.client && session.sessionId) {
      await session.client.endSession().catch(() => {});
    }
  } catch {
    // best-effort
  }
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
    setOnToolCallArrived(session.mcpSessionToken, null);
    session.mcpSessionToken = undefined;
  }
  session.pendingToolCallNotifier = null;
  session.turnActive = false;
}

/** 현재 ACP turn의 listener/abort/toolCall acceptance 수명주기 관리 */
function createTurnCleanup(
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
    if (session.mcpSessionToken) {
      setToolCallAcceptance(session.mcpSessionToken, false);
    }
    if (mapper.output.stopReason !== "toolUse") {
      session.turnActive = false;
      session.sendPromptError = false;
    }
  };
}

/** mapper 종료 지점(toolUse 포함)에 turn cleanup을 연결 */
function attachTurnCleanup(
  session: AcpSessionState,
  mapper: ReturnType<typeof createEventMapper>,
  removeListeners: () => void,
  cleanupAbort: () => void,
): void {
  const cleanup = createTurnCleanup(session, mapper, removeListeners, cleanupAbort);
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
  const mapper = createEventMapper(model.id);
  const streamOptions = options as StreamOptionsLike | undefined;
  const cwd = streamOptions?.cwd ?? process.cwd();
  let scopeKey: string;
  try {
    scopeKey = getSessionScopeKey(streamOptions, cwd);
  } catch (err) {
    queueMicrotask(() => {
      mapper.finishWithError("error", errorMessage(err));
    });
    return mapper.stream;
  }
  const systemPromptHash = hashSystemPrompt(context.systemPrompt);
  const state = getOrInitState();
  const toolResults = extractAllToolResults(context);
  const isToolResultDelivery = toolResults.length > 0;
  const toolResultSession = isToolResultDelivery ? resolveToolResultSession(state, toolResults) : null;

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

  // 새 prompt 시작 시 sendPromptError 플래그 초기화
  const existingSession = getSessionByScope(state, cli, scopeKey);
  if (existingSession?.sendPromptError) {
    existingSession.sendPromptError = false;
    debug("sendPromptError 플래그 초기화 (새 prompt 시작)");
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
  let session: AcpSessionState;
  try {
    session = await ensureSession(cli, backendModel, scopeKey, cwd, systemPromptHash, context.tools);
  } catch (err) {
    mapper.finishWithError("error", `ACP 연결 실패: ${errorMessage(err)}`);
    return;
  }

  if (!session.client || !session.sessionId) {
    mapper.finishWithError("error", "ACP 세션이 유효하지 않습니다");
    return;
  }

  // ── 프롬프트 구성 ──
  let finalPrompt = promptText;
  if (!session.firstPromptSent) {
    finalPrompt = buildInitialPrompt(context, promptText);
    debug("XML 구조화 초기 프롬프트 주입 (첫 프롬프트)");
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

  session.turnActive = true;
  if (session.mcpSessionToken) {
    setToolCallAcceptance(session.mcpSessionToken, true);
  }
  attachTurnCleanup(session, mapper, removeListeners, cleanupAbort);

  // ── sendMessage — fire-and-forget ──
  // sendMessage는 promptComplete까지 resolve되지 않음.
  // MCP tool call 시 event-mapper가 done="toolUse"로 스트림 종료.
  // sendMessage는 계속 pending — ACP CLI가 MCP 응답 대기 중이므로 이벤트 없음.
  debug(`sendMessage: cli=${cli} model=${backendModel} prompt=${finalPrompt.slice(0, 60)}...`);

  client.sendMessage(finalPrompt).then(() => {
    session.firstPromptSent = true;
    session.lastSystemPromptHash = systemPromptHash;
    if (session.pendingToolCalls.length === 0) {
      session.turnActive = false;
    }
    debug("sendMessage 완료 (promptComplete 처리됨)");
  }).catch((err) => {
    if (wasAborted.value) return;
    const msg = errorMessage(err);
    debug(`sendMessage 에러: ${msg}`);
    session.sendPromptError = true;
    session.turnActive = session.pendingToolCalls.length > 0;
    debug(`sendPromptError 플래그 설정: key=${key}`);
    // mapper가 아직 finished가 아니면 에러 발행
    mapper.finishWithError("error", `ACP 요청 실패: ${msg}`);
  }).finally(() => {
    if (session.mcpSessionToken) {
      setToolCallAcceptance(session.mcpSessionToken, false);
    }
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
  if (session.mcpSessionToken) {
    setToolCallAcceptance(session.mcpSessionToken, true);
  }

  // 매퍼가 done="toolUse" (다음 tool call) 또는 done="stop" (완료)을 emit할 때까지 대기
  // sendMessage()는 Case 1에서 이미 호출되어 pending — 다시 호출하지 않음
  // mapper의 finishDone/finishWithError를 래핑하여 정리 로직 트리거
  // (EventStream에는 .on("end") 없음 — push/end/[Symbol.asyncIterator]만 지원)
  attachTurnCleanup(session, mapper, removeListeners, cleanupAbort);

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
    if (session.mcpSessionToken) {
      clearPendingForSession(session.mcpSessionToken);
    }
    clearSessionRoutingState(state, session);
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

/** UnifiedAgentClient에 이벤트 리스너 등록 — 해제 함수 반환 */
function wireListeners(
  client: UnifiedAgentClient,
  mapper: ReturnType<typeof createEventMapper>,
  session: AcpSessionState,
  mcpToken?: string,
): () => void {
  const { listeners } = mapper;

  client.on("messageChunk", listeners.onMessageChunk);
  client.on("thoughtChunk", listeners.onThoughtChunk);
  client.on("toolCall", listeners.onToolCall);
  client.on("toolCallUpdate", listeners.onToolCallUpdate);
  client.on("promptComplete", listeners.onPromptComplete);
  client.on("error", listeners.onError);
  client.on("exit", listeners.onExit);

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
  _piSessionId?: string,
): Promise<void> {
  const state = getOrInitState();

  // new/fork/resume 모두 기존 세션 정리 — 새 연결 시 히스토리로 컨텍스트 전달
  await clearSessionsAndPreSpawn(state);
  debug(`session_start(${reason}): 세션 + MCP 초기화`);
}

/** 세션, MCP tool registry, toolCall 라우팅 상태 일괄 정리 */
async function clearSessionsAndPreSpawn(state: AcpProviderState): Promise<void> {
  for (const session of state.sessions.values()) {
    clearSessionRoutingState(state, session);
    await disconnectSession(session);
    releaseSession(session.sessionKey);
  }
  state.sessions.clear();
  state.sessionKeysByScope.clear();
  state.toolCallToSessionKey.clear();
  clearAllTools();
}
