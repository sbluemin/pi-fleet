/**
 * core/agentclientprotocol/executor.ts — 실행 엔진
 *
 * 풀 기반 실행, 원샷 실행, 저수준 세션 획득 API를 제공합니다.
 * 세션 관리가 완전 캡슐화되어 외부에서 sessionId를 직접 주입할 필요가 없습니다.
 * PI API 타입을 사용하지 않습니다.
 */

import { getReasoningEffortLevels, UnifiedAgentClient } from "@sbluemin/unified-agent";
import type { CliType, McpServerConfig, UnifiedClientOptions } from "@sbluemin/unified-agent";
import type {
  ExecuteOptions,
  ExecuteResult,
  AgentStatus,
  ToolCallInfo,
  ConnectionInfo,
} from "./types.js";
import { disconnectClient, getClientPool, isClientAlive, type PooledClient } from "./pool.js";
import {
  buildModelId,
  getCliSystemPrompt,
  getSessionLaunchConfig,
  setSessionLaunchConfig,
} from "./provider-types.js";
import { getSessionStore } from "./runtime.js";
import { getLogAPI } from "../log/bridge.js";
import { buildCarrierSystemPrompt } from "../../fleet/shipyard/carrier/prompts.js";

type ToolCallLike = {
  content?: unknown;
  rawOutput?: unknown;
  toolCallId?: string;
};

type SystemPromptPolicy = "inherit-global" | "carrier" | "none";

type ResumeFailureKind =
  | "dead-session"
  | "capability-mismatch"
  | "auth"
  | "transport"
  | "model-config"
  | "timeout"
  | "abort"
  | "unknown";

/** acquireSession 옵션 */
export interface AcquireOptions {
  /** 풀 키 (carrierId에 한정되지 않는 일반 키) */
  key: string;
  /** CLI 바이너리 타입 */
  cliType: CliType;
  /** 작업 디렉토리 */
  cwd: string;
  /** 명시적 모델 ID */
  model?: string;
  /** connect 시 주입할 MCP 서버 목록 */
  mcpServers?: McpServerConfig[];
  /** Abort 시그널 */
  signal?: AbortSignal;
  /**
   * Reasoning effort 레벨 (예: "low" | "medium" | "high").
   *
   * 시맨틱 (sticky):
   * - 명시 시: setConfigOption("reasoning_effort", value)로 세션에 적용하고 launch metadata에 저장.
   * - 미지정 시: 기존 세션/풀 엔트리의 값이 유지됨 (호출이 발생하지 않음).
   * - fresh reconnect 시: 명시 값이 없으면 보존된 launch metadata effort로 자동 폴백되어 재적용.
   * - 리셋이 필요하면 호출자가 명시적 레벨을 전달해야 함.
   * - CLI 지원 여부는 unified-agent의 getReasoningEffortLevels(cli)로 사전 검사되며,
   *   미지원 CLI에서는 호출 자체가 스킵됨.
   */
  effort?: string;
  /** Claude thinking budget tokens */
  budgetTokens?: number;
  /** 프롬프트 유휴 타임아웃 (ms) */
  promptIdleTimeout?: number;
  /** CLI config override 목록 */
  configOverrides?: string[];
  /** 커스텀 환경변수 (cleanEnvironment에 병합) */
  env?: Record<string, string>;
  /** YOLO 모드 (자동 승인), 기본값 true */
  yoloMode?: boolean;
}

/** acquireSession 반환값 */
export interface AcquiredSession {
  /** 연결된 UnifiedAgentClient */
  client: UnifiedAgentClient;
  /** 현재 활성 session ID */
  sessionId: string;
  /** 연결 메타 정보 */
  connectionInfo: ConnectionInfo;
  /** 클라이언트를 풀에 반환하며 busy를 해제 */
  release: () => void;
}

// ─── 상수 ────────────────────────────────────────────────

/** SDK 연결 시 사용할 공통 clientInfo */
const CLIENT_INFO = { name: "pi-unified-agent", version: "1.0.0" } as const;

/** 도구 호출 최대 보관 수 (메모리 보호) */
const MAX_TOOL_CALLS_TO_KEEP = 30;

const DEAD_SESSION_PATTERNS = [
  /session not found/i,
  /unknown session/i,
  /invalid session/i,
  /closed session/i,
  /expired session/i,
];

const AUTH_PATTERNS = [
  /auth/i,
  /login/i,
  /unauthorized/i,
  /permission denied/i,
  /invalid api key/i,
];

// ─── executeWithPool: 풀 기반 실행 ─────────────────────

/**
 * 풀 기반 실행 (agent-tool + 에이전트 모드 공통)
 *
 * 세션 관리 완전 캡슐화:
 *  1. store.get(carrierId) → 매핑된 세션이 있으면 connectOpts.sessionId에 설정
 *  2. 연결 성공 → store.set(carrierId, id) 자동 저장
 *  3. resume 실패 → store.clear(carrierId) + 새 세션 자동 재시도
 *  4. 이미 연결된 경우 기존 세션 ID를 그대로 재사용
 */
export async function executeWithPool(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { carrierId, cliType, request, cwd, signal } = opts;
  const clientPool = getClientPool();

  const store = getSessionStore();

  // 결과 상태
  let responseText = "";
  let thoughtText = "";
  const toolCalls: ToolCallInfo[] = [];
  const connectionInfo: ConnectionInfo = {};
  let status: AgentStatus = "connecting";
  let error: string | undefined;
  let aborted = false;
  let isLivePrompt = false;

  opts.onStatusChange?.("connecting");

  // ── 클라이언트 풀에서 가져오기 또는 새로 생성 ──
  let poolEntry = clientPool.get(carrierId);
  let isTemporary = false;

  if (poolEntry) {
    if (poolEntry.busy) {
      // 동시 호출 — 임시 클라이언트로 fallback
      poolEntry = undefined;
      isTemporary = true;
    } else if (!isClientAlive(poolEntry.client)) {
      // 죽은 클라이언트 — 풀에서 제거 후 새로 생성
      clientPool.delete(carrierId);
      poolEntry = undefined;
    }
  }

  let client: UnifiedAgentClient;

  if (poolEntry) {
    client = poolEntry.client;
    poolEntry.busy = true;
  } else {
    client = new UnifiedAgentClient();
    if (!isTemporary) {
      const newEntry: PooledClient = { client, busy: true };
      clientPool.set(carrierId, newEntry);
      poolEntry = newEntry;
      client.on("exit", () => {
        const current = clientPool.get(carrierId);
        if (current?.client === client) clientPool.delete(carrierId);
      });
    }
  }

  let detachCoreStderrLogging = attachCoreStderrLogging(client, `acp-exec:${carrierId}`);

  // 임시 클라이언트 정리 함수
  const cleanupTemporary = async () => {
    if (!isTemporary) return;
    try { await client.disconnect(); } catch { /* 정리 실패 무시 */ }
    client.removeAllListeners();
  };

  // ── AbortSignal 처리 ──
  const onAbort = () => {
    if (aborted) return;
    aborted = true;
    status = "aborted";
    opts.onStatusChange?.("aborted");
    void Promise.allSettled([
      client.cancelPrompt(),
      isTemporary ? cleanupTemporary() : disconnectClient(carrierId, client),
    ]);
  };

  if (signal?.aborted) {
    detachCoreStderrLogging();
    if (poolEntry) {
      poolEntry.busy = false;
    }
    if (isTemporary) {
      await cleanupTemporary();
    }
    return {
      responseText: "",
      thoughtText: "",
      toolCalls: [],
      connectionInfo,
      status: "aborted",
    };
  }

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  // ── 이벤트 리스너 ──
  const onMessageChunk = (text: string) => {
    if (!isLivePrompt) return;
    responseText += text;
    opts.onMessageChunk?.(text);
  };
  const onThoughtChunk = (text: string) => {
    if (!isLivePrompt) return;
    thoughtText += text;
    opts.onThoughtChunk?.(text);
  };
  const upsertToolCall = (title: string, tcStatus: string, rawOutput?: string, toolCallId?: string) => {
    if (!isLivePrompt) return;
    // toolCallId가 있으면 toolCallId 기준, 없으면 title 기준 (하위 호환)
    const existing = toolCalls.find((tc) =>
      toolCallId ? tc.toolCallId === toolCallId : tc.title === title,
    );
    if (existing) {
      existing.status = tcStatus;
      if (rawOutput !== undefined) {
        existing.rawOutput = rawOutput;
      }
    } else {
      toolCalls.push({ title, status: tcStatus, rawOutput, toolCallId, timestamp: Date.now() });
    }
    if (toolCalls.length > MAX_TOOL_CALLS_TO_KEEP) {
      toolCalls.splice(0, toolCalls.length - MAX_TOOL_CALLS_TO_KEEP);
    }
    opts.onToolCall?.(title, tcStatus, rawOutput, toolCallId);
  };
  const onToolCall = (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
    upsertToolCall(title, tcStatus, extractToolResultText(data), data?.toolCallId);
  };
  const onToolCallUpdate = (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
    upsertToolCall(title, tcStatus, extractToolResultText(data), data?.toolCallId);
  };
  const onError = (err: Error) => {
    if (!aborted) error = err.message;
  };

  const attachListeners = () => {
    client.on("messageChunk", onMessageChunk);
    client.on("thoughtChunk", onThoughtChunk);
    client.on("toolCall", onToolCall);
    client.on("toolCallUpdate", onToolCallUpdate);
    client.on("error", onError);
  };
  const detachListeners = () => {
    client.off("messageChunk", onMessageChunk);
    client.off("thoughtChunk", onThoughtChunk);
    client.off("toolCall", onToolCall);
    client.off("toolCallUpdate", onToolCallUpdate);
    client.off("error", onError);
  };

  attachListeners();

  try {
    let needsConnect = !isClientAlive(client);

    if (!needsConnect && hasSystemPromptDrift(client, "carrier")) {
      debugSystemPromptDrift("executeWithPool", carrierId, cliType);
      store.clear(carrierId);
      if (poolEntry) {
        delete poolEntry.sessionId;
      }
      await client.disconnect();
      needsConnect = true;
    }

    if (needsConnect) {
      // ── 연결 옵션 구성 ──
      // Carrier 실행 경로 — 전역 systemPrompt 미주입 (persona는 composeTier2Request가 user request에 주입)
      const connectOpts = buildConnectOptions(cliType, cwd, {
        model: opts.model,
        promptIdleTimeout: opts.promptIdleTimeout,
      }, "carrier");

      // 세션 매핑에서 저장된 sessionId를 우선 사용
      const savedSessionId = store.get(carrierId) ?? poolEntry?.sessionId;
      if (savedSessionId) {
        connectOpts.sessionId = savedSessionId;
      }

      let connectResult;
      try {
        connectResult = await raceAbort(client.connect(connectOpts), signal);
      } catch (connectError) {
        // abort로 인한 reject이면 재시도하지 않고 즉시 전파
        if (aborted) throw connectError;
        // sessionId로 resume 실패 시 dead-session 계열만 새 세션으로 재시도
        if (!savedSessionId) throw connectError;
        if (classifyResumeFailure(connectError) !== "dead-session") {
          throw connectError;
        }

        console.error(
          `[unified-agent] session/load 실패 (carrierId=${carrierId}, sessionId=${savedSessionId}):`,
          connectError instanceof Error ? connectError.message : connectError,
        );

        store.clear(carrierId);
        if (poolEntry) delete poolEntry.sessionId;
        delete connectOpts.sessionId;

        // 실패한 연결 정리 후 클라이언트 재생성
        try { await client.disconnect(); } catch {}
        detachListeners();
        detachCoreStderrLogging();
        client = new UnifiedAgentClient();
        detachCoreStderrLogging = attachCoreStderrLogging(client, `acp-exec:${carrierId}`);
        if (!isTemporary) {
          poolEntry = { client, busy: true };
          clientPool.set(carrierId, poolEntry);
          client.on("exit", () => {
            const current = clientPool.get(carrierId);
            if (current?.client === client) clientPool.delete(carrierId);
          });
        }
        attachListeners();
        connectResult = await raceAbort(client.connect(connectOpts), signal);
      }

      connectionInfo.protocol = connectResult.protocol;
      connectionInfo.sessionId = connectResult.session?.sessionId ?? undefined;

      // ACP 세션에서 모델 정보 추출
      const sessionAny = connectResult.session as Record<string, unknown> | undefined;
      if (sessionAny?.models && Array.isArray(sessionAny.models) && sessionAny.models.length > 0) {
        connectionInfo.model = String(sessionAny.models[0]);
      }

      // 풀 엔트리 + 세션 매핑에 sessionId 보존
      if (poolEntry && connectionInfo.sessionId) {
        poolEntry.sessionId = connectionInfo.sessionId;
      }
      if (connectionInfo.sessionId) {
        store.set(carrierId, connectionInfo.sessionId);
      }

      await applyPostConnectConfig(client, cliType, resolveLaunchOverrides(carrierId, {
        effort: opts.effort,
        budgetTokens: opts.budgetTokens,
      }));
    } else {
      // 이미 연결됨 — 기존 연결 정보 사용
      // model은 connect 시점에만 지정 가능하므로 재연결 없이는 변경 불가
      const info = client.getConnectionInfo();
      connectionInfo.protocol = info.protocol ?? undefined;
      connectionInfo.sessionId = info.sessionId ?? undefined;

      // 풀 + 세션 매핑에 sessionId 갱신
      if (poolEntry && connectionInfo.sessionId) {
        poolEntry.sessionId = connectionInfo.sessionId;
      }
      if (connectionInfo.sessionId) {
        store.set(carrierId, connectionInfo.sessionId);
      }

      // effort/budgetTokens는 setConfigOption으로 사후 적용 가능 — 명시적 override가 있을 때만 적용
      if (opts.effort || opts.budgetTokens) {
        await applyPostConnectConfig(client, cliType, {
          effort: opts.effort,
          budgetTokens: opts.budgetTokens,
        });
      }
    }

    if (aborted) {
      return { responseText, thoughtText, toolCalls, connectionInfo, status, error };
    }

    opts.onConnected?.(connectionInfo);
    status = "running";
    opts.onStatusChange?.("running");

    // session/load 중 재생된 과거 이벤트는 버리고, 현재 프롬프트부터만 누적합니다.
    responseText = "";
    thoughtText = "";
    toolCalls.length = 0;
    isLivePrompt = true;

    // ── 메시지 전송 (블로킹: 프롬프트 완료까지 대기) ──
    await client.sendMessage(request);

    // 세션 구현이 내부적으로 ID를 갱신한 경우를 대비해 최신 값을 반영합니다.
    const postSendInfo = client.getConnectionInfo();
    if (postSendInfo.sessionId && postSendInfo.sessionId !== connectionInfo.sessionId) {
      connectionInfo.sessionId = postSendInfo.sessionId;
      if (poolEntry) poolEntry.sessionId = postSendInfo.sessionId;
      store.set(carrierId, postSendInfo.sessionId);
    }

    if (!aborted) {
      status = "done";
      if (!responseText.trim()) responseText = "(no output)";
      opts.onStatusChange?.("done");
    }
  } catch (err) {
    if (!aborted) {
      const message = err instanceof Error ? err.message : String(err);
      status = "error";
      error = message;
      if (!responseText) responseText = message;
      opts.onStatusChange?.("error");
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    detachListeners();
    detachCoreStderrLogging();
    if (poolEntry) poolEntry.busy = false;

    // 임시 클라이언트가 얻은 sessionId를 풀의 기존 엔트리에도 반영하여
    // 다음 실행 시 최신 세션으로 resume할 수 있게 합니다.
    if (isTemporary && connectionInfo.sessionId) {
      const existingEntry = clientPool.get(carrierId);
      if (existingEntry) {
        existingEntry.sessionId = connectionInfo.sessionId;
      }
    }
    await cleanupTemporary();
  }

  return { responseText, thoughtText, toolCalls, connectionInfo, status, error };
}

// ─── executeOneShot: 비풀 일회성 실행 ─────────────────────

/**
 * 비풀 일회성 실행
 * 매번 새 UnifiedAgentClient를 생성 → 실행 → disconnect
 * 세션 매핑을 사용하지 않습니다.
 */
export async function executeOneShot(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { cliType, request, cwd, signal } = opts;

  let responseText = "";
  let thoughtText = "";
  const toolCalls: ToolCallInfo[] = [];
  const connectionInfo: ConnectionInfo = {};
  let status: AgentStatus = "connecting";
  let error: string | undefined;

  opts.onStatusChange?.("connecting");

  const client = new UnifiedAgentClient();
  const detachCoreStderrLogging = attachCoreStderrLogging(client, `acp-exec:${opts.carrierId}`);
  let aborted = false;

  const onAbort = () => {
    if (aborted) return;
    aborted = true;
    status = "aborted";
    opts.onStatusChange?.("aborted");
    void Promise.allSettled([
      client.cancelPrompt(),
      client.disconnect(),
    ]);
  };

  try {
    if (signal?.aborted) {
      return { responseText: "", thoughtText: "", toolCalls: [], connectionInfo, status: "aborted" };
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // 연결 옵션 구성
    // Carrier 실행 경로 — 전역 systemPrompt 미주입 (persona는 composeTier2Request가 user request에 주입)
    const connectOpts = buildConnectOptions(cliType, cwd, {
      model: opts.model,
      promptIdleTimeout: opts.promptIdleTimeout,
    }, "carrier");

    await raceAbort(client.connect(connectOpts), signal);
    await applyPostConnectConfig(client, cliType, {
      effort: opts.effort,
      budgetTokens: opts.budgetTokens,
    });

    if (aborted) {
      return { responseText, thoughtText, toolCalls, connectionInfo, status, error };
    }

    connectionInfo.protocol = (client.getConnectionInfo() as any).protocol ?? undefined;
    connectionInfo.sessionId = (client.getConnectionInfo() as any).sessionId ?? undefined;

    opts.onConnected?.(connectionInfo);
    status = "running";
    opts.onStatusChange?.("running");

    // 이벤트 리스너 등록
    client.on("messageChunk", (text: string) => {
      responseText += text;
      opts.onMessageChunk?.(text);
    });
    client.on("thoughtChunk", (text: string) => {
      thoughtText += text;
      opts.onThoughtChunk?.(text);
    });
    const upsertToolCall = (title: string, tcStatus: string, rawOutput?: string, toolCallId?: string) => {
      // toolCallId가 있으면 toolCallId 기준, 없으면 title 기준 (하위 호환)
      const existing = toolCalls.find((tc) =>
        toolCallId ? tc.toolCallId === toolCallId : tc.title === title,
      );
      if (existing) {
        existing.status = tcStatus;
        if (rawOutput !== undefined) {
          existing.rawOutput = rawOutput;
        }
      } else {
        toolCalls.push({ title, status: tcStatus, rawOutput, toolCallId, timestamp: Date.now() });
      }
      opts.onToolCall?.(title, tcStatus, rawOutput, toolCallId);
    };
    client.on("toolCall", (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
      upsertToolCall(title, tcStatus, extractToolResultText(data), data?.toolCallId);
    });
    client.on("toolCallUpdate", (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
      upsertToolCall(title, tcStatus, extractToolResultText(data), data?.toolCallId);
    });

    await client.sendMessage(request);

    if (!aborted) {
      status = "done";
      if (!responseText.trim()) responseText = "(no output)";
      opts.onStatusChange?.("done");
    }
  } catch (e) {
    if (!aborted) {
      status = "error";
      error = e instanceof Error ? e.message : String(e);
      if (!responseText) responseText = `Error: ${error}`;
      opts.onStatusChange?.("error");
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    detachCoreStderrLogging();
    try { await client.disconnect(); } catch { /* 정리 실패 무시 */ }
    client.removeAllListeners();
  }

  return { responseText, thoughtText, toolCalls, connectionInfo, status, error };
}

/**
 * 풀에서 세션을 획득합니다.
 * 공통 연결 및 resume 흐름만 수행하며, 프롬프트 전송은 호출자가 담당합니다.
 */
export async function acquireSession(opts: AcquireOptions): Promise<AcquiredSession> {
  const { key, cliType, cwd, signal } = opts;
  const clientPool = getClientPool();
  const store = getSessionStore();

  // 1. 풀에서 클라이언트를 가져오거나 새로 만듭니다.
  let poolEntry = clientPool.get(key);

  if (poolEntry) {
    if (poolEntry.busy) {
      throw new Error(`Session ${key} is busy`);
    }
    if (!isClientAlive(poolEntry.client)) {
      clientPool.delete(key);
      poolEntry = undefined;
    }
  }

  let client: UnifiedAgentClient;

  if (poolEntry) {
    client = poolEntry.client;
    poolEntry.busy = true;
  } else {
    client = new UnifiedAgentClient();
    const newEntry: PooledClient = { client, busy: true };
    clientPool.set(key, newEntry);
    poolEntry = newEntry;
    client.on("exit", () => {
      const current = clientPool.get(key);
      if (current?.client === client) clientPool.delete(key);
    });
  }

  let detachCoreStderrLogging = attachCoreStderrLogging(client, `acp-exec:${key}`);

  // 2. connect 전에 abort를 확인합니다.
  if (signal?.aborted) {
    detachCoreStderrLogging();
    poolEntry.busy = false;
    throw new Error("Aborted");
  }

  const connectionInfo: ConnectionInfo = {};

  try {
    let needsConnect = !isClientAlive(client);

    if (!needsConnect && hasSystemPromptDrift(client, "inherit-global")) {
      debugSystemPromptDrift("acquireSession", key, cliType);
      store.clear(key);
      if (poolEntry) {
        delete poolEntry.sessionId;
      }
      await client.disconnect();
      needsConnect = true;
    }

    if (needsConnect) {
      // Admiral host 경로 — 전역 systemPrompt 상속
      const connectOpts = buildConnectOptions(cliType, cwd, {
        model: opts.model,
        promptIdleTimeout: opts.promptIdleTimeout,
      }, "inherit-global");

      connectOpts.yoloMode = opts.yoloMode !== false;
      if (opts.promptIdleTimeout !== undefined) {
        connectOpts.promptIdleTimeout = opts.promptIdleTimeout;
      }
      if (opts.mcpServers) connectOpts.mcpServers = opts.mcpServers;
      if (opts.configOverrides) connectOpts.configOverrides = opts.configOverrides;
      if (opts.env) connectOpts.env = opts.env;

      const savedSessionId = store.get(key) ?? poolEntry?.sessionId;
      if (savedSessionId) {
        connectOpts.sessionId = savedSessionId;
      }

      let connectResult;
      try {
        connectResult = await client.connect(connectOpts);
      } catch (connectError) {
        if (signal?.aborted) throw connectError;
        if (!savedSessionId) throw connectError;
        if (classifyResumeFailure(connectError) !== "dead-session") {
          throw connectError;
        }

        store.clear(key);
        if (poolEntry) delete poolEntry.sessionId;
        delete connectOpts.sessionId;

        try {
          await client.disconnect();
        } catch {}
        client.removeAllListeners();
        detachCoreStderrLogging();
        client = new UnifiedAgentClient();
        detachCoreStderrLogging = attachCoreStderrLogging(client, `acp-exec:${key}`);
        poolEntry = { client, busy: true };
        clientPool.set(key, poolEntry);
        client.on("exit", () => {
          const current = clientPool.get(key);
          if (current?.client === client) clientPool.delete(key);
        });

        connectResult = await client.connect(connectOpts);
      }

      connectionInfo.protocol = connectResult.protocol;
      connectionInfo.sessionId = connectResult.session?.sessionId ?? undefined;

      const sessionAny = connectResult.session as Record<string, unknown> | undefined;
      if (sessionAny?.models && Array.isArray(sessionAny.models) && sessionAny.models.length > 0) {
        connectionInfo.model = String(sessionAny.models[0]);
      }

      if (poolEntry && connectionInfo.sessionId) {
        poolEntry.sessionId = connectionInfo.sessionId;
      }
      if (connectionInfo.sessionId) {
        store.set(key, connectionInfo.sessionId);
      }

      await applyPostConnectConfig(client, cliType, resolveLaunchOverrides(key, {
        effort: opts.effort,
        budgetTokens: opts.budgetTokens,
      }));
    } else {
      const info = client.getConnectionInfo();
      connectionInfo.protocol = info.protocol ?? undefined;
      connectionInfo.sessionId = info.sessionId ?? undefined;

      if (poolEntry && connectionInfo.sessionId) {
        poolEntry.sessionId = connectionInfo.sessionId;
      }
      if (connectionInfo.sessionId) {
        store.set(key, connectionInfo.sessionId);
      }

      if (opts.effort || opts.budgetTokens) {
        await applyPostConnectConfig(client, cliType, {
          effort: opts.effort,
          budgetTokens: opts.budgetTokens,
        });
      }
    }

    if (opts.model) {
      setSessionLaunchConfig(key, {
        modelId: buildModelId(cliType, opts.model),
        ...(opts.effort ? { effort: opts.effort } : {}),
        ...(opts.budgetTokens ? { budgetTokens: opts.budgetTokens } : {}),
      });
    }
  } catch (err) {
    detachCoreStderrLogging();
    poolEntry.busy = false;
    throw err;
  }

  detachCoreStderrLogging();

  const release = () => {
    if (poolEntry) poolEntry.busy = false;
  };

  return {
    client,
    sessionId: connectionInfo.sessionId ?? "",
    connectionInfo,
    release,
  };
}

/** 세션을 풀에 반환하며 busy 상태를 해제합니다. */
export function releaseSession(key: string): void {
  const pool = getClientPool();
  const entry = pool.get(key);
  if (entry) entry.busy = false;
}

function extractToolResultText(data?: ToolCallLike): string | undefined {
  if (!data) return undefined;

  const contentText = extractContentText(data.content);
  if (contentText) {
    return contentText;
  }

  if (data.rawOutput !== undefined && data.rawOutput !== null) {
    return typeof data.rawOutput === "string"
      ? data.rawOutput
      : JSON.stringify(data.rawOutput, null, 2);
  }

  return undefined;
}

function extractContentText(content: unknown): string | undefined {
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;

    const typedItem = item as {
      type?: unknown;
      content?: { type?: unknown; text?: unknown };
      path?: unknown;
      newText?: unknown;
      oldText?: unknown;
    };

    if (typedItem.type === "content") {
      const block = typedItem.content;
      if (block?.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
      continue;
    }

    if (typedItem.type === "diff" && typeof typedItem.path === "string" && typeof typedItem.newText === "string") {
      const newLines = typedItem.newText.split("\n").length;
      const oldLines = typeof typedItem.oldText === "string"
        ? typedItem.oldText.split("\n").length
        : 0;
      const delta = newLines - oldLines;
      const sign = delta >= 0 ? `+${delta}` : `${delta}`;
      parts.push(`${typedItem.path}: ${sign} lines`);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n");
}

/**
 * promise와 AbortSignal을 경합시켜, signal abort 시 즉시 reject합니다.
 * connect() 등 내부적으로 signal을 지원하지 않는 비동기 작업에서
 * abort 반응성을 확보하기 위해 사용합니다.
 */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Aborted"));
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("Aborted")),
        { once: true },
      );
    }),
  ]);
}

/**
 * CLI 연결에 필요한 공통 옵션 객체를 구성합니다.
 * 호출자가 주입한 model 값을 그대로 사용합니다.
 */
function buildConnectOptions(
  cli: CliType,
  cwd: string,
  overrides: { model?: string; promptIdleTimeout?: number } | undefined,
  policy: SystemPromptPolicy,
): UnifiedClientOptions {
  const opts: UnifiedClientOptions = {
    cwd,
    cli,
    autoApprove: true,
    clientInfo: CLIENT_INFO,
    timeout: 0,
  };

  if (overrides?.model) {
    opts.model = overrides.model;
  }

  if (overrides?.promptIdleTimeout !== undefined) {
    opts.promptIdleTimeout = overrides.promptIdleTimeout;
  }

  if (policy === "inherit-global") {
    const systemPrompt = getCliSystemPrompt();
    if (systemPrompt) {
      opts.systemPrompt = systemPrompt;
    }
  } else if (policy === "carrier") {
    opts.systemPrompt = buildCarrierSystemPrompt();
  }

  return opts;
}

function hasSystemPromptDrift(
  client: UnifiedAgentClient,
  policy: SystemPromptPolicy,
): boolean {
  const expected = policy === "inherit-global"
    ? getCliSystemPrompt()
    : policy === "carrier"
      ? buildCarrierSystemPrompt()
      : null;
  return normalizeSystemPrompt(client.getCurrentSystemPrompt()) !== normalizeSystemPrompt(expected);
}

function normalizeSystemPrompt(systemPrompt: string | null | undefined): string {
  return systemPrompt?.trim() ?? "";
}

function debugSystemPromptDrift(scope: string, key: string, cliType: CliType): void {
  console.warn(`[unified-agent] systemPrompt drift 감지 (${scope}, key=${key}, cli=${cliType})`);
}

/**
 * 연결 후 추론 설정을 세션에 적용합니다.
 * 호출자가 주입한 effort/budgetTokens 값을 그대로 사용합니다.
 */
export async function applyPostConnectConfig(
  client: UnifiedAgentClient,
  cli: CliType,
  overrides?: { effort?: string; budgetTokens?: number },
): Promise<void> {
  if (overrides?.effort) {
    if (supportsReasoningEffort(cli)) {
      try {
        await client.setConfigOption("reasoning_effort", overrides.effort);
      } catch (err) {
        console.warn(`[acp] setConfigOption 실패 (cli=${cli}, option=reasoning_effort)`, err);
      }
    }
  }

  if (cli === "claude" && overrides?.budgetTokens) {
    try {
      await client.setConfigOption("budget_tokens", String(overrides.budgetTokens));
    } catch (err) {
      console.warn(`[acp] setConfigOption 실패 (cli=${cli}, option=budget_tokens)`, err);
    }
  }
}

function supportsReasoningEffort(cli: CliType): boolean {
  const levels = getReasoningEffortLevels(cli);
  return Array.isArray(levels) && levels.length > 0;
}

function resolveLaunchOverrides(
  key: string,
  overrides?: { effort?: string; budgetTokens?: number },
): { effort?: string; budgetTokens?: number } | undefined {
  const launchConfig = getSessionLaunchConfig(key);
  const effort = overrides?.effort ?? launchConfig?.effort;
  const budgetTokens = overrides?.budgetTokens ?? launchConfig?.budgetTokens;

  if (!effort && !budgetTokens) {
    return overrides;
  }

  return {
    effort,
    budgetTokens,
  };
}

function classifyResumeFailure(error: unknown): ResumeFailureKind {
  const message = extractErrorMessage(error);
  if (message === "Aborted") {
    return "abort";
  }
  if (DEAD_SESSION_PATTERNS.some((pattern) => pattern.test(message))) {
    return "dead-session";
  }
  if (/loadSession.*지원하지 않/i.test(message) || /session\/load.*지원하지 않/i.test(message)) {
    return "capability-mismatch";
  }
  if (AUTH_PATTERNS.some((pattern) => pattern.test(message))) {
    return "auth";
  }
  if (/spawn|initialize|transport|econn|pipe|closed/i.test(message)) {
    return "transport";
  }
  if (/model|config|mcp/i.test(message)) {
    return "model-config";
  }
  if (/timeout|timed out|유휴 상태/i.test(message)) {
    return "timeout";
  }
  return "unknown";
}

function attachCoreStderrLogging(client: UnifiedAgentClient, source: string): () => void {
  const log = getLogAPI();
  const onLogEntry = (entry: { message: string; cli?: string; sessionId?: string }) => {
    const normalized = normalizeDiagnosticStderr(entry.message);
    if (!normalized) {
      return;
    }

    const parts = [
      entry.cli ? `cli=${entry.cli}` : null,
      entry.sessionId ? `session=${entry.sessionId}` : null,
      normalized,
    ].filter(Boolean);

    log.debug(source, parts.join(" "), {
      category: "acp-stderr",
      hideFromFooter: true,
    });
  };

  client.on("logEntry", onLogEntry as never);
  return () => {
    client.off("logEntry", onLogEntry as never);
  };
}

function normalizeDiagnosticStderr(message: string): string | null {
  const stripped = message.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!stripped) {
    return null;
  }
  if (/^[\|\/\\\-⠁-⣿\.\s]+$/.test(stripped)) {
    return null;
  }
  return stripped;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}
