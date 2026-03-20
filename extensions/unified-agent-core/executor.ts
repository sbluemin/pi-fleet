/**
 * unified-agent-core — 실행기
 *
 * 풀 기반(executeWithPool) 및 원샷(executeOneShot) 실행을 제공합니다.
 * 세션 관리가 완전 캡슐화되어 외부에서 sessionId를 제공/변경할 수 없습니다.
 * PI API 타입을 사용하지 않습니다.
 */

import { UnifiedAgentClient } from "@sbluemin/unified-agent";
import type {
  CliType,
  ExecuteOptions,
  ExecuteResult,
  AgentStatus,
  ToolCallInfo,
  ConnectionInfo,
} from "./types";
import { disconnectClient, getClientPool, isClientAlive, type PooledClient } from "./client-pool";
import type { SessionMapStore } from "./session-map";
import { buildConnectOptions, loadSelectedModels } from "./model-config";

// ─── 도구 호출 최대 보관 수 (메모리 보호) ────────────────

const MAX_TOOL_CALLS_TO_KEEP = 30;

type ToolCallLike = {
  content?: unknown;
  rawOutput?: unknown;
};

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

// ─── AbortSignal 경합 헬퍼 ───────────────────────────────

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
 * 연결 후 저장된 추론 설정을 세션에 적용합니다.
 * 현재 unified-agent SDK는 추론 관련 옵션을 connect 옵션으로 받지 않으므로
 * CLI 경로와 동일하게 setConfigOption으로 별도 반영합니다.
 */
async function applyPostConnectConfig(
  client: UnifiedAgentClient,
  cli: CliType,
  configDir: string,
): Promise<void> {
  const cliConfig = loadSelectedModels(configDir)[cli];
  if (!cliConfig) {
    return;
  }

  if (cliConfig.effort) {
    try {
      await client.setConfigOption("reasoning_effort", cliConfig.effort);
    } catch {
      // reasoning_effort 미지원 CLI는 조용히 무시합니다.
    }
  }

  if (cli === "claude" && cliConfig.budgetTokens) {
    try {
      await client.setConfigOption("budget_tokens", String(cliConfig.budgetTokens));
    } catch {
      // budget_tokens 미지원 세션은 조용히 무시합니다.
    }
  }
}

// ─── executeWithPool: 풀 기반 실행 ─────────────────────

/**
 * 풀 기반 실행 (agent-tool + 에이전트 모드 공통)
 *
 * 세션 관리 완전 캡슐화:
 *  1. store.get(cli) → 매핑된 세션이 있으면 connectOpts.sessionId에 설정
 *  2. 연결 성공 → store.set(cli, id) 자동 저장
 *  3. resume 실패 → store.clear(cli) + 새 세션 자동 재시도
 *  4. 이미 연결된 경우 기존 세션 ID를 그대로 재사용
 */
export async function executeWithPool(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { cli, request, cwd, configDir, signal } = opts;
  const clientPool = getClientPool();

  // sessionStore가 없으면 no-op (하위 호환 / executeOneShot 경유 방지)
  const noopStore: SessionMapStore = {
    restore() {},
    get() { return undefined; },
    set() {},
    clear() {},
    getAll() { return {}; },
  };
  const store = opts.sessionStore ?? noopStore;

  // 결과 상태
  let responseText = "";
  let thoughtText = "";
  const toolCalls: ToolCallInfo[] = [];
  const connectionInfo: ConnectionInfo = {};
  let status: AgentStatus = "connecting";
  let error: string | undefined;
  let aborted = false;

  opts.onStatusChange?.("connecting");

  // ── 클라이언트 풀에서 가져오기 또는 새로 생성 ──
  let poolEntry = clientPool.get(cli);
  let isTemporary = false;

  if (poolEntry) {
    if (poolEntry.busy) {
      // 동시 호출 — 임시 클라이언트로 fallback
      poolEntry = undefined;
      isTemporary = true;
    } else if (!isClientAlive(poolEntry.client)) {
      // 죽은 클라이언트 — 풀에서 제거 후 새로 생성
      clientPool.delete(cli);
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
      clientPool.set(cli, newEntry);
      poolEntry = newEntry;
      client.on("exit", () => {
        const current = clientPool.get(cli);
        if (current?.client === client) clientPool.delete(cli);
      });
    }
  }

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
      isTemporary ? cleanupTemporary() : disconnectClient(cli, client),
    ]);
  };

  if (signal?.aborted) {
    if (poolEntry) poolEntry.busy = false;
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
    responseText += text;
    opts.onMessageChunk?.(text);
  };
  const onThoughtChunk = (text: string) => {
    thoughtText += text;
    opts.onThoughtChunk?.(text);
  };
  const upsertToolCall = (title: string, tcStatus: string, rawOutput?: string) => {
    const existing = toolCalls.find((tc) => tc.title === title);
    if (existing) {
      existing.status = tcStatus;
      if (rawOutput !== undefined) {
        existing.rawOutput = rawOutput;
      }
    } else {
      toolCalls.push({ title, status: tcStatus, rawOutput, timestamp: Date.now() });
    }
    if (toolCalls.length > MAX_TOOL_CALLS_TO_KEEP) {
      toolCalls.splice(0, toolCalls.length - MAX_TOOL_CALLS_TO_KEEP);
    }
    opts.onToolCall?.(title, tcStatus, rawOutput);
  };
  const onToolCall = (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
    upsertToolCall(title, tcStatus, extractToolResultText(data));
  };
  const onToolCallUpdate = (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
    upsertToolCall(title, tcStatus, extractToolResultText(data));
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
    const needsConnect = !isClientAlive(client);

    if (needsConnect) {
      // ── 연결 옵션 구성 ──
      const connectOpts = buildConnectOptions(cli, cwd, configDir);

      // 세션 매핑에서 저장된 sessionId를 우선 사용
      const savedSessionId = store.get(cli) ?? poolEntry?.sessionId;
      if (savedSessionId) {
        connectOpts.sessionId = savedSessionId;
      }

      let connectResult;
      try {
        connectResult = await raceAbort(client.connect(connectOpts as any), signal);
      } catch (connectError) {
        // abort로 인한 reject이면 재시도하지 않고 즉시 전파
        if (aborted) throw connectError;
        // sessionId로 resume 실패 시 새 세션으로 재시도
        if (!savedSessionId) throw connectError;

        console.error(
          `[unified-agent] session/load 실패 (cli=${cli}, sessionId=${savedSessionId}):`,
          connectError instanceof Error ? connectError.message : connectError,
        );

        store.clear(cli);
        delete connectOpts.sessionId;

        // 실패한 연결 정리 후 클라이언트 재생성
        try { await client.disconnect(); } catch {}
        detachListeners();
        client = new UnifiedAgentClient();
        if (!isTemporary) {
          poolEntry = { client, busy: true };
          clientPool.set(cli, poolEntry);
          client.on("exit", () => {
            const current = clientPool.get(cli);
            if (current?.client === client) clientPool.delete(cli);
          });
        }
        attachListeners();
        connectResult = await raceAbort(client.connect(connectOpts as any), signal);
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
        store.set(cli, connectionInfo.sessionId);
      }

      await applyPostConnectConfig(client, cli, configDir);
    } else {
      // 이미 연결됨 — 기존 연결 정보 사용
      const info = client.getConnectionInfo();
      connectionInfo.protocol = info.protocol ?? undefined;
      connectionInfo.sessionId = info.sessionId ?? undefined;

      // 풀 + 세션 매핑에 sessionId 갱신
      if (poolEntry && connectionInfo.sessionId) {
        poolEntry.sessionId = connectionInfo.sessionId;
      }
      if (connectionInfo.sessionId) {
        store.set(cli, connectionInfo.sessionId);
      }
    }

    if (aborted) {
      return { responseText, thoughtText, toolCalls, connectionInfo, status, error };
    }

    opts.onConnected?.(connectionInfo);
    status = "running";
    opts.onStatusChange?.("running");

    // ── 메시지 전송 (블로킹: 프롬프트 완료까지 대기) ──
    await client.sendMessage(request);

    // 세션 구현이 내부적으로 ID를 갱신한 경우를 대비해 최신 값을 반영합니다.
    const postSendInfo = client.getConnectionInfo();
    if (postSendInfo.sessionId && postSendInfo.sessionId !== connectionInfo.sessionId) {
      connectionInfo.sessionId = postSendInfo.sessionId;
      if (poolEntry) poolEntry.sessionId = postSendInfo.sessionId;
      store.set(cli, postSendInfo.sessionId);
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
    if (poolEntry) poolEntry.busy = false;
    await cleanupTemporary();
  }

  return { responseText, thoughtText, toolCalls, connectionInfo, status, error };
}

// ─── executeOneShot: 비풀 실행 (All 모드용) ─────────────

/**
 * 비풀 실행 (All 모드용)
 * 매번 새 UnifiedAgentClient를 생성 → 실행 → disconnect
 * 세션 매핑을 사용하지 않습니다.
 */
export async function executeOneShot(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { cli, request, cwd, configDir, signal } = opts;

  let responseText = "";
  let thoughtText = "";
  const toolCalls: ToolCallInfo[] = [];
  const connectionInfo: ConnectionInfo = {};
  let status: AgentStatus = "connecting";
  let error: string | undefined;

  opts.onStatusChange?.("connecting");

  const client = new UnifiedAgentClient();
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
    const connectOpts = buildConnectOptions(cli, cwd, configDir);

    await raceAbort(client.connect(connectOpts as any), signal);
    await applyPostConnectConfig(client, cli, configDir);

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
    const upsertToolCall = (title: string, tcStatus: string, rawOutput?: string) => {
      const existing = toolCalls.find((tc) => tc.title === title);
      if (existing) {
        existing.status = tcStatus;
        if (rawOutput !== undefined) {
          existing.rawOutput = rawOutput;
        }
      } else {
        toolCalls.push({ title, status: tcStatus, rawOutput, timestamp: Date.now() });
      }
      opts.onToolCall?.(title, tcStatus, rawOutput);
    };
    client.on("toolCall", (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
      upsertToolCall(title, tcStatus, extractToolResultText(data));
    });
    client.on("toolCallUpdate", (title: string, tcStatus: string, _sessionId: string, data?: ToolCallLike) => {
      upsertToolCall(title, tcStatus, extractToolResultText(data));
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
    try { await client.disconnect(); } catch { /* 정리 실패 무시 */ }
    client.removeAllListeners();
  }

  return { responseText, thoughtText, toolCalls, connectionInfo, status, error };
}
