/**
 * core/acp-provider/provider — ACP 기반 streamSimple 구현
 *
 * AcpConnection을 직접 사용하여 Gemini/Codex CLI 백엔드를 pi TUI에 통합.
 * Virtual Tool 방식: ACP CLI가 투명 스트리밍 백엔드. pi tool 루프 우회.
 * context.messages에서 최신 user 메시지만 추출하여 sendPrompt()에 전달.
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
import { spawn } from "child_process";
import crypto from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { Readable, Writable } from "stream";
import {
  AcpConnection,
  createSpawnConfig,
  createPreSpawnConfig,
  ndJsonStream,
  cleanEnvironment,
  isWindows,
} from "@sbluemin/unified-agent";
import type { CliType, AcpMcpServer } from "@sbluemin/unified-agent";

import {
  type AcpSessionState,
  type AcpProviderState,
  type PreSpawnEntry,
  DEFAULT_REQUEST_TIMEOUT,
  DEFAULT_INIT_TIMEOUT,
  DEFAULT_PROMPT_IDLE_TIMEOUT,
  PRE_SPAWN_MAX_AGE_MS,
  CLI_CAPABILITIES,
  parseModelId,
  hashSystemPrompt,
  getOrInitState,
} from "./types.js";
import { createEventMapper } from "./event-mapper.js";
import { getLogAPI } from "../log/bridge.js";
import {
  startMcpServer,
  stopMcpServer,
  resolveNextToolCall,
  clearPendingForSession,
  setOnToolCallArrived,
  type McpCallToolResult,
} from "./mcp-server.js";
import {
  registerToolsForSession,
  removeToolsForSession,
  clearAllTools,
  computeToolHash,
  getToolNamesForSession,
} from "./tool-registry.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/** 영속화할 세션 정보 형식 */
interface PersistedSession {
  sessionId: string;
  cli: string;
  currentModel: string;
  lastSystemPromptHash: string;
  cwd: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 영속화 파일 경로 */
const SESSION_FILE = join(process.cwd(), ".fleet", "acp-sessions.json");

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
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

/** pi session key 생성 — pi에서 전달하는 context 기반 */
function getSessionKey(cwd: string): string {
  return `acp:${cwd}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// AcpConnection 생성/관리
// ═══════════════════════════════════════════════════════════════════════════

/** AcpConnection을 생성하고 반환 */
function createAcpConnection(
  cli: CliType,
  cwd: string,
  backendModel?: string,
): AcpConnection {
  const spawnConfig = createSpawnConfig(cli, {
    cwd,
    model: backendModel,
    yoloMode: true, // 자동 승인 — pi가 직접 permission 관리하지 않음
  });

  return new AcpConnection({
    command: spawnConfig.command,
    args: spawnConfig.args,
    cwd,
    env: cleanEnvironment(process.env),
    requestTimeout: DEFAULT_REQUEST_TIMEOUT,
    initTimeout: DEFAULT_INIT_TIMEOUT,
    promptIdleTimeout: DEFAULT_PROMPT_IDLE_TIMEOUT,
    clientInfo: { name: "pi-fleet-acp", version: "1.0.0" },
    autoApprove: true,
  });
}

/**
 * 세션 상태를 가져오거나 새로 생성.
 * systemPrompt drift 감지 시 기존 세션 폐기.
 * CLI 변경 시 기존 세션 폐기.
 */
async function ensureSession(
  cli: CliType,
  backendModel: string,
  cwd: string,
  systemPromptHash: string,
  tools?: Tool[],
): Promise<AcpSessionState> {
  const state = getOrInitState();
  const key = getSessionKey(cwd);
  let session = state.sessions.get(key);

  // tool hash 계산
  const currentToolHash = tools && tools.length > 0 ? computeToolHash(tools) : undefined;

  // CLI 변경, systemPrompt drift, tool hash 변경 — 기존 세션 폐기
  // 단, 복원된 세션(connection=null, sessionId존재)에서는 systemPrompt drift 무시
  // — resume 시 pi가 systemPrompt를 새로 생성하므로 hash가 달라질 수 있음
  if (session) {
    const cliChanged = session.cli !== cli;
    const isRestoredSession = !session.connection && !!session.sessionId;
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
      // MCP tool registry 정리
      if (session.mcpSessionToken) {
        removeToolsForSession(session.mcpSessionToken);
      }
      await disconnectSession(session);
      state.sessions.delete(key);
      session = undefined;
    }
  }

  // connection이 없지만 sessionId가 있으면 resume 복원 시도 (session/load)
  if (session && !session.connection && session.sessionId) {
    const cap = CLI_CAPABILITIES[cli as keyof typeof CLI_CAPABILITIES];
    if (cap?.supportsSessionLoad) {
      debug(`session/load 복원 시도: ${session.sessionId.slice(0, 8)}`);
      const connection = createAcpConnection(cli, cwd, backendModel);
      try {
        const acpSession = await connection.connect(cwd, session.sessionId);
        session.connection = connection;
        session.sessionId = acpSession.sessionId;
        session.firstPromptSent = true; // 이전 대화가 있으므로
        session.currentModel = backendModel;
        session.lastSystemPromptHash = systemPromptHash; // resume 후 hash 갱신
        replenishPreSpawn(cli);
        debug(`session/load 복원 성공: ${acpSession.sessionId.slice(0, 8)}`);
        return session;
      } catch (err) {
        debug(`session/load 실패, 새 세션으로 fallback:`, errorMessage(err));
        try { await connection.disconnect(); } catch { /* noop */ }
        session.sessionId = null; // stale sessionId 정리
      }
    } else {
      debug(`CLI ${cli}는 session/load 미지원 — 새 세션 생성`);
      session.sessionId = null;
    }
  }

  // 기존 세션이 유효하면 재사용 — 모델 변경 시 setModel 호출
  if (session?.connection && session.sessionId) {
    if (session.currentModel !== backendModel) {
      debug(`모델 변경 감지: ${session.currentModel} → ${backendModel}`);
      try {
        await session.connection.setModel(session.sessionId, backendModel);
        session.currentModel = backendModel;
        debug(`setModel 성공: ${backendModel}`);
      } catch (err) {
        // setModel 실패 — 세션 폐기 후 재생성으로 fallback
        debug(`setModel 실패, 세션 재생성으로 fallback:`, errorMessage(err));
        await disconnectSession(session);
        state.sessions.delete(key);
        session = undefined;
      }
    }
    if (session) {
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
  const connection = createAcpConnection(cli, cwd, backendModel);
  const newSession: AcpSessionState = {
    connection,
    sessionId: null,
    cwd,
    lastSystemPromptHash: systemPromptHash,
    cli,
    firstPromptSent: false,
    currentModel: backendModel,
    mcpSessionToken: mcpActive ? sessionToken : undefined,
    toolHash: currentToolHash,
  };

  // preSpawn 핸들이 있으면 사용
  const preSpawnEntry = consumePreSpawn(cli);

  try {
    let acpSession;
    if (preSpawnEntry) {
      debug(`preSpawn 핸들 사용: cli=${cli}`);
      acpSession = await connection.connectWithExternalProcess(
        preSpawnEntry.child,
        preSpawnEntry.stream,
        cwd,
        undefined,
        mcpServers,
      );
    } else {
      debug(`새 연결 시작: cli=${cli}`);
      acpSession = await connection.connect(cwd, undefined, mcpServers);
    }

    newSession.sessionId = acpSession.sessionId;
    state.sessions.set(key, newSession);

    // preSpawn replenish (lazy: 연결 성공 후)
    replenishPreSpawn(cli);

    debug(`세션 생성 완료: ${acpSession.sessionId.slice(0, 8)}`);
    return newSession;
  } catch (err) {
    // 실패 시 정리
    if (mcpActive) removeToolsForSession(sessionToken);
    try { await connection.disconnect(); } catch { /* noop */ }
    throw err;
  }
}

/** 세션 연결 해제 — preserveSessionId가 true이면 sessionId를 보존 (resume용) */
async function disconnectSession(
  session: AcpSessionState,
  preserveSessionId = false,
): Promise<void> {
  if (!session.connection) return;
  try {
    if (session.sessionId) {
      await session.connection.endSession(session.sessionId);
    }
  } catch {
    // best-effort
  }
  try {
    await session.connection.disconnect();
  } catch {
    // best-effort
  }
  session.connection = null;
  if (!preserveSessionId) {
    session.sessionId = null;
  }
  // MCP tool registry 정리
  if (session.mcpSessionToken) {
    removeToolsForSession(session.mcpSessionToken);
    session.mcpSessionToken = undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// preSpawn 관리
// ═══════════════════════════════════════════════════════════════════════════

/** preSpawn 핸들 소비 — stale이면 정리하고 null 반환 */
function consumePreSpawn(cli: CliType): PreSpawnEntry | null {
  const state = getOrInitState();
  const entry = state.preSpawnPool.get(cli);
  if (!entry) return null;

  state.preSpawnPool.delete(cli);

  // stale 검사
  if (Date.now() - entry.createdAt > PRE_SPAWN_MAX_AGE_MS) {
    debug(`preSpawn stale (${cli}): age=${Date.now() - entry.createdAt}ms`);
    try { entry.child.kill(); } catch { /* noop */ }
    return null;
  }

  // 프로세스가 이미 종료됐는지 확인
  if (entry.child.exitCode !== null) {
    debug(`preSpawn already exited (${cli}): exitCode=${entry.child.exitCode}`);
    return null;
  }

  return entry;
}

/** preSpawn replenish — 비동기로 새 핸들 생성 */
function replenishPreSpawn(cli: CliType): void {
  const state = getOrInitState();
  // 이미 있으면 skip
  if (state.preSpawnPool.has(cli)) return;

  // 비동기로 warm-up (실패는 조용히 로깅만)
  doPreSpawn(cli).then((entry) => {
    if (entry) {
      // 사이에 다른 핸들이 생겼으면 새로 만든 것 정리
      if (state.preSpawnPool.has(cli)) {
        try { entry.child.kill(); } catch { /* noop */ }
        return;
      }
      state.preSpawnPool.set(cli, entry);
      debug(`preSpawn replenish 완료: ${cli}`);
    }
  }).catch((err) => {
    debug(`preSpawn replenish 실패 (${cli}):`, errorMessage(err));
  });
}

/** 실제 preSpawn 수행 — UnifiedAgentClient.preSpawn() 패턴 참조 */
async function doPreSpawn(cli: CliType): Promise<PreSpawnEntry | null> {
  const spawnConfig = createPreSpawnConfig(cli);
  const cleanEnv = cleanEnvironment(process.env);

  const env: Record<string, string | undefined> = { ...cleanEnv };
  if (cli === "gemini" && isWindows() && env.GEMINI_CLI_NO_RELAUNCH === undefined) {
    env.GEMINI_CLI_NO_RELAUNCH = "true";
  }

  const command = isWindows()
    ? ((env.ComSpec as string) ?? "cmd.exe")
    : spawnConfig.command;
  const args = isWindows()
    ? ["/c", spawnConfig.command, ...spawnConfig.args]
    : spawnConfig.args;

  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: env as NodeJS.ProcessEnv,
  });

  const webWritable = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
  const webReadable = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(webWritable, webReadable);

  // 즉시 종료 감지 (2초 대기)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve();
    }, 2000);

    const onExit = (code: number | null): void => {
      clearTimeout(timer);
      reject(new Error(
        `pre-spawn 프로세스가 즉시 종료되었습니다 (exitCode: ${code}, cli: ${cli})`,
      ));
    };

    child.once("exit", onExit);
  });

  return {
    cli,
    child,
    stream,
    createdAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// streamAcp — provider 진입점
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Provider 진입점 — pi의 streamSimple 계약 구현.
 *
 * 두 가지 모드:
 * Case 1 (fresh query): sendPrompt() 호출, MCP tool call 시 done="toolUse"로 pi에 양보
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
  const cwd = (options as { cwd?: string } | undefined)?.cwd ?? process.cwd();
  const systemPromptHash = hashSystemPrompt(context.systemPrompt);
  const state = getOrInitState();
  const key = getSessionKey(cwd);

  // ── Case 감지: 마지막 메시지가 toolResult이고 activeSessionKey가 있으면 Case 2 ──
  const lastMsg = context.messages[context.messages.length - 1];
  const isToolResultDelivery = lastMsg?.role === "toolResult" && state.activeSessionKey === key;

  const mapper = createEventMapper(model.id);

  if (isToolResultDelivery) {
    // ── Case 2: tool result delivery ──
    runToolResultDelivery(key, context, model, options, mapper).catch((err) => {
      debug(`tool result delivery 에러:`, errorMessage(err));
      mapper.finishWithError("error", errorMessage(err));
    });
  } else {
    // ── Case 1: fresh query ──
    runFreshQuery(cli, backendModel, cwd, context, systemPromptHash, model, options, mapper).catch((err) => {
      debug(`streamAcp 치명적 에러:`, errorMessage(err));
      mapper.finishWithError("error", errorMessage(err));
    });
  }

  return mapper.stream;
}

// ═══════════════════════════════════════════════════════════════════════════
// Case 1: Fresh query — sendPrompt 호출
// ═══════════════════════════════════════════════════════════════════════════

async function runFreshQuery(
  cli: CliType,
  backendModel: string,
  cwd: string,
  context: Context,
  systemPromptHash: string,
  model: Model<any>,
  options: SimpleStreamOptions | undefined,
  mapper: ReturnType<typeof createEventMapper>,
): Promise<void> {
  const state = getOrInitState();
  const key = getSessionKey(cwd);

  // 이전 activeQuery 정리
  state.activeSessionKey = null;

  // ── 프롬프트 추출 ──
  let promptText = extractLatestUserMessage(context);
  if (!promptText) {
    debug("WARNING: empty prompt — fallback to [continue]");
    promptText = "[continue]";
  }

  // ── 세션 확보 ──
  let session: AcpSessionState;
  try {
    session = await ensureSession(cli, backendModel, cwd, systemPromptHash, context.tools);
  } catch (err) {
    mapper.finishWithError("error", `ACP 연결 실패: ${errorMessage(err)}`);
    return;
  }

  if (!session.connection || !session.sessionId) {
    mapper.finishWithError("error", "ACP 세션이 유효하지 않습니다");
    return;
  }

  // ── systemPrompt prefix 주입 (첫 프롬프트만) ──
  let finalPrompt = promptText;
  if (!session.firstPromptSent && context.systemPrompt) {
    finalPrompt = `${context.systemPrompt}\n\n---\n\n${promptText}`;
    debug("systemPrompt prefix 주입 (첫 프롬프트)");
  }

  // 매퍼 설정
  mapper.setTargetSessionId(session.sessionId);
  if (session.mcpSessionToken) {
    mapper.setPiToolNames(getToolNamesForSession(session.mcpSessionToken));
  }

  // ── 이벤트 리스너 등록 ──
  const conn = session.connection;
  const removeListeners = wireListeners(conn, mapper, session.mcpSessionToken);

  // ── abort 핸들링 ──
  const { wasAborted, cleanupAbort } = setupAbortHandling(session, state, mapper, removeListeners, options);
  if (wasAborted.value) return;

  // ── sendPrompt — fire-and-forget ──
  // sendPrompt는 promptComplete까지 resolve되지 않음.
  // MCP tool call 시 event-mapper가 done="toolUse"로 스트림 종료.
  // sendPrompt는 계속 pending — ACP CLI가 MCP 응답 대기 중이므로 이벤트 없음.
  debug(`sendPrompt: cli=${cli} model=${backendModel} prompt=${finalPrompt.slice(0, 60)}...`);

  conn.sendPrompt(session.sessionId, finalPrompt).then(() => {
    session.firstPromptSent = true;
    session.lastSystemPromptHash = systemPromptHash;
    // promptComplete 이벤트가 발화되면 mapper가 done="stop" emit
    // → 여기서는 activeSessionKey 정리만
    state.activeSessionKey = null;
    debug("sendPrompt 완료 (promptComplete 처리됨)");
  }).catch((err) => {
    if (wasAborted.value) return;
    const msg = errorMessage(err);
    debug(`sendPrompt 에러: ${msg}`);
    state.activeSessionKey = null;
    // mapper가 아직 finished가 아니면 에러 발행
    mapper.finishWithError("error", `ACP 요청 실패: ${msg}`);
  }).finally(() => {
    removeListeners();
    cleanupAbort();
  });

  // activeSessionKey 설정 — tool result delivery를 위해
  state.activeSessionKey = key;

  // 매퍼 스트림이 종료될 때까지 대기 (done="toolUse" 또는 done="stop")
  // 스트림 종료는 mapper 내부에서 처리됨 — 여기서는 기다리지 않음
}

// ═══════════════════════════════════════════════════════════════════════════
// Case 2: Tool result delivery — FIFO 큐 resolve
// ═══════════════════════════════════════════════════════════════════════════

async function runToolResultDelivery(
  key: string,
  context: Context,
  model: Model<any>,
  options: SimpleStreamOptions | undefined,
  mapper: ReturnType<typeof createEventMapper>,
): Promise<void> {
  const state = getOrInitState();
  const session = state.sessions.get(key);

  if (!session?.connection || !session.sessionId || !session.mcpSessionToken) {
    mapper.finishWithError("error", "tool result delivery: 세션이 유효하지 않습니다");
    state.activeSessionKey = null;
    return;
  }

  debug("Case 2: tool result delivery");

  // ── toolResult 추출 및 MCP 결과로 변환 ──
  const toolResults = extractAllToolResults(context);
  for (const result of toolResults) {
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
    resolveNextToolCall(session.mcpSessionToken, mcpResult);
    debug(`tool result → MCP resolve 완료`);
  }

  // ── 새 이벤트 매퍼로 ACP 이벤트 계속 수신 ──
  mapper.setTargetSessionId(session.sessionId);
  if (session.mcpSessionToken) {
    mapper.setPiToolNames(getToolNamesForSession(session.mcpSessionToken));
  }

  // 이벤트 리스너 재등록 — ACP CLI가 MCP 응답 받고 계속 처리
  const conn = session.connection;
  const removeListeners = wireListeners(conn, mapper, session.mcpSessionToken);

  // abort 핸들링
  const { wasAborted: _wasAborted, cleanupAbort } = setupAbortHandling(session, state, mapper, removeListeners, options);
  if (_wasAborted.value) return;

  // 매퍼가 done="toolUse" (다음 tool call) 또는 done="stop" (완료)을 emit할 때까지 대기
  // sendPrompt()는 Case 1에서 이미 호출되어 pending — 다시 호출하지 않음
  // mapper의 finishDone/finishWithError를 래핑하여 정리 로직 트리거
  // (EventStream에는 .on("end") 없음 — push/end/[Symbol.asyncIterator]만 지원)

  const originalFinishDone = mapper.finishDone;
  const originalFinishWithError = mapper.finishWithError;

  const cleanup = (): void => {
    removeListeners();
    cleanupAbort();
    // done="stop"이면 activeSessionKey 정리
    if (mapper.output.stopReason !== "toolUse") {
      state.activeSessionKey = null;
    }
  };

  mapper.finishDone = (): void => {
    originalFinishDone();
    cleanup();
  };

  mapper.finishWithError = (reason: "aborted" | "error", message: string): void => {
    originalFinishWithError(reason, message);
    cleanup();
  };
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
    if (session.connection && session.sessionId) {
      session.connection.cancelSession(session.sessionId).catch(() => {});
    }
    if (session.mcpSessionToken) {
      clearPendingForSession(session.mcpSessionToken);
    }
    state.activeSessionKey = null;
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

/** AcpConnection에 이벤트 리스너 등록 — 해제 함수 반환 */
function wireListeners(
  conn: AcpConnection,
  mapper: ReturnType<typeof createEventMapper>,
  mcpToken?: string,
): () => void {
  const { listeners } = mapper;

  conn.on("messageChunk", listeners.onMessageChunk);
  conn.on("thoughtChunk", listeners.onThoughtChunk);
  conn.on("toolCall", listeners.onToolCall);
  conn.on("toolCallUpdate", listeners.onToolCallUpdate);
  conn.on("promptComplete", listeners.onPromptComplete);
  conn.on("error", listeners.onError);
  conn.on("exit", listeners.onExit);

  // MCP tool call 도착 콜백 — token 기준 격리
  if (mcpToken) {
    setOnToolCallArrived(mcpToken, (toolName, args) => {
      mapper.emitMcpToolCall(toolName, args);
    });
  }

  return (): void => {
    conn.off("messageChunk", listeners.onMessageChunk);
    conn.off("thoughtChunk", listeners.onThoughtChunk);
    conn.off("toolCall", listeners.onToolCall);
    conn.off("toolCallUpdate", listeners.onToolCallUpdate);
    conn.off("promptComplete", listeners.onPromptComplete);
    conn.off("error", listeners.onError);
    conn.off("exit", listeners.onExit);
    if (mcpToken) setOnToolCallArrived(mcpToken, null);
  };
}

/** context.messages에서 모든 toolResult 추출 (끝에서부터 연속) */
function extractAllToolResults(
  context: Context,
): Array<{ content: unknown; isError?: boolean; toolCallId?: string }> {
  const results: Array<{ content: unknown; isError?: boolean; toolCallId?: string }> = [];
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
 * 모든 ACP 세션과 preSpawn 핸들 정리.
 * session_shutdown 이벤트에서 호출.
 * 종료 전 sessionId를 파일에 영속화하여 resume 시 복원 가능.
 */
export async function cleanupAll(): Promise<void> {
  const state = getOrInitState();

  // sessionId 영속화 (disconnect 전에 저장)
  saveSessionState(state);

  await clearSessionsAndPreSpawn(state);

  // MCP 서버 종료
  await stopMcpServer();

  debug("cleanupAll 완료");
}

/**
 * session_start 이벤트 처리.
 * new: 모든 상태 초기화
 * resume: 기존 세션 유지 (reconnect 시도)
 * fork: 새 상태로 시작
 */
export async function handleSessionStart(
  reason: "new" | "resume" | "fork",
): Promise<void> {
  const state = getOrInitState();

  if (reason === "new" || reason === "fork") {
    await clearSessionsAndPreSpawn(state);
    debug(`session_start(${reason}): 세션 + preSpawn + MCP 초기화`);
  } else if (reason === "resume") {
    restoreSessionState(state);
    debug("session_start(resume): 세션 상태 복원 완료");
  }
}

/** 세션, preSpawn, MCP tool registry, activeSessionKey 일괄 정리 */
async function clearSessionsAndPreSpawn(state: AcpProviderState): Promise<void> {
  for (const [key, session] of state.sessions) {
    await disconnectSession(session);
    state.sessions.delete(key);
  }
  for (const [_cli, entry] of state.preSpawnPool) {
    try { entry.child.kill(); } catch { /* noop */ }
  }
  state.preSpawnPool.clear();
  clearAllTools();
  state.activeSessionKey = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 세션 영속화 — .fleet/acp-sessions.json
// ═══════════════════════════════════════════════════════════════════════════

/** 세션 상태를 파일에 저장 — shutdown 시 호출 */
function saveSessionState(state: AcpProviderState): void {
  try {
    const data: Record<string, PersistedSession> = {};
    for (const [key, session] of state.sessions) {
      if (session.sessionId) {
        data[key] = {
          sessionId: session.sessionId,
          cli: session.cli,
          currentModel: session.currentModel,
          lastSystemPromptHash: session.lastSystemPromptHash,
          cwd: session.cwd,
        };
      }
    }
    if (Object.keys(data).length === 0) return;
    mkdirSync(join(process.cwd(), ".fleet"), { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), "utf-8");
    debug(`세션 상태 저장: ${Object.keys(data).length}개`);
  } catch (err) {
    debug("세션 상태 저장 실패 (silent):", errorMessage(err));
  }
}

/** 파일에서 세션 상태 복원 — resume 시 호출 */
function restoreSessionState(state: AcpProviderState): void {
  try {
    const raw = readFileSync(SESSION_FILE, "utf-8");
    const data = JSON.parse(raw) as Record<string, PersistedSession>;

    for (const [key, persisted] of Object.entries(data)) {
      // 이미 Map에 있으면 skip (cleanupAll 후 resume라 없을 것이지만 방어)
      if (state.sessions.has(key)) continue;

      const session: AcpSessionState = {
        connection: null, // 프로세스 죽었으므로 null
        sessionId: persisted.sessionId, // session/load에 사용
        cwd: persisted.cwd,
        lastSystemPromptHash: persisted.lastSystemPromptHash,
        cli: persisted.cli as CliType,
        firstPromptSent: true, // 이전 대화가 있었으므로
        currentModel: persisted.currentModel,
      };
      state.sessions.set(key, session);
      debug(`세션 복원: ${key} → ${persisted.sessionId.slice(0, 8)}`);
    }
  } catch {
    // 파일 없거나 파싱 실패 — 새 세션으로 시작
    debug("세션 상태 복원 실패 (silent) — 새 세션으로 시작");
  }
}
