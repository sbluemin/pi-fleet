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
import { getSubSessionId, setSubSessionId, clearSubSessionId } from "./session-map";
import { buildConnectOptions } from "./model-config";

// ─── 도구 호출 최대 보관 수 (메모리 보호) ────────────────

const MAX_TOOL_CALLS_TO_KEEP = 30;

// ─── executeWithPool: 풀 기반 실행 ─────────────────────

/**
 * 풀 기반 실행 (agent-tool + direct-mode 공통)
 *
 * 세션 관리 완전 캡슐화:
 *  1. getSubSessionId(cli) → 매핑된 세션이 있으면 connectOpts.sessionId에 설정
 *  2. 연결 성공 → setSubSessionId(cli, id) 자동 저장
 *  3. resume 실패 → clearSubSessionId(cli) + 새 세션 자동 재시도
 *  4. 이미 연결된 경우 direct 프로토콜 세션 ID도 자동 복원
 */
export async function executeWithPool(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { cli, request, cwd, configDir, signal } = opts;
  const clientPool = getClientPool();

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
  const onToolCall = (title: string, tcStatus: string) => {
    const existing = toolCalls.find((tc) => tc.title === title);
    if (existing) {
      existing.status = tcStatus;
    } else {
      toolCalls.push({ title, status: tcStatus, timestamp: Date.now() });
    }
    if (toolCalls.length > MAX_TOOL_CALLS_TO_KEEP) {
      toolCalls.splice(0, toolCalls.length - MAX_TOOL_CALLS_TO_KEEP);
    }
    opts.onToolCall?.(title, tcStatus);
  };
  const onError = (err: Error) => {
    if (!aborted) error = err.message;
  };

  const attachListeners = () => {
    client.on("messageChunk", onMessageChunk);
    client.on("thoughtChunk", onThoughtChunk);
    client.on("toolCall", onToolCall);
    client.on("error", onError);
  };
  const detachListeners = () => {
    client.off("messageChunk", onMessageChunk);
    client.off("thoughtChunk", onThoughtChunk);
    client.off("toolCall", onToolCall);
    client.off("error", onError);
  };

  attachListeners();

  try {
    const needsConnect = !isClientAlive(client);

    if (needsConnect) {
      // ── 연결 옵션 구성 ──
      const connectOpts = buildConnectOptions(cli, cwd, configDir);

      // 세션 매핑에서 저장된 sessionId를 우선 사용
      const savedSessionId = getSubSessionId(cli) ?? poolEntry?.sessionId;
      if (savedSessionId) {
        connectOpts.sessionId = savedSessionId;
      }

      let connectResult;
      try {
        connectResult = await client.connect(connectOpts as any);
      } catch (connectError) {
        // sessionId로 resume 실패 시 새 세션으로 재시도
        if (!savedSessionId) throw connectError;

        console.error(
          `[unified-agent] session/load 실패 (cli=${cli}, sessionId=${savedSessionId}):`,
          connectError instanceof Error ? connectError.message : connectError,
        );

        clearSubSessionId(cli);
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
        connectResult = await client.connect(connectOpts as any);
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
        setSubSessionId(cli, connectionInfo.sessionId);
      }
    } else {
      // 이미 연결됨 — 기존 연결 정보 사용
      const info = client.getConnectionInfo();
      connectionInfo.protocol = info.protocol ?? undefined;
      connectionInfo.sessionId = info.sessionId ?? undefined;

      // direct 모드: 세션 매핑에서 복원된 sessionId를 SDK에 반영
      if (info.protocol === "direct") {
        const savedSessionId = getSubSessionId(cli) ?? poolEntry?.sessionId;
        if (savedSessionId && savedSessionId !== info.sessionId) {
          client.setDirectSessionId(savedSessionId);
          connectionInfo.sessionId = savedSessionId;
        }
      }

      // 풀 + 세션 매핑에 sessionId 갱신
      if (poolEntry && connectionInfo.sessionId) {
        poolEntry.sessionId = connectionInfo.sessionId;
      }
      if (connectionInfo.sessionId) {
        setSubSessionId(cli, connectionInfo.sessionId);
      }
    }

    opts.onConnected?.(connectionInfo);
    status = "running";
    opts.onStatusChange?.("running");

    // ── 메시지 전송 (블로킹: 프롬프트 완료까지 대기) ──
    await client.sendMessage(request);

    // Direct 모드 보정: sendMessage 이후 sessionId가 갱신될 수 있음
    // (codex exec의 thread_id는 프로세스 실행 후에야 확정됨)
    const postSendInfo = client.getConnectionInfo();
    if (postSendInfo.sessionId && postSendInfo.sessionId !== connectionInfo.sessionId) {
      connectionInfo.sessionId = postSendInfo.sessionId;
      if (poolEntry) poolEntry.sessionId = postSendInfo.sessionId;
      setSubSessionId(cli, postSendInfo.sessionId);
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
    // 연결 옵션 구성
    const connectOpts = buildConnectOptions(cli, cwd, configDir);

    await client.connect(connectOpts as any);

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
    client.on("toolCall", (title: string, tcStatus: string) => {
      const existing = toolCalls.find((tc) => tc.title === title);
      if (existing) {
        existing.status = tcStatus;
      } else {
        toolCalls.push({ title, status: tcStatus, timestamp: Date.now() });
      }
      opts.onToolCall?.(title, tcStatus);
    });

    // abort 처리
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    await client.sendMessage(request);

    status = "done";
    if (!responseText.trim()) responseText = "(no output)";
    opts.onStatusChange?.("done");
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
