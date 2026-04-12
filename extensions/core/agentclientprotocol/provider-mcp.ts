/**
 * core/acp-provider/mcp-server — HTTP 기반 in-process MCP 서버 singleton
 *
 * Raw JSON-RPC 2.0 구현으로 MCP SDK 의존성 없이 동작.
 * loopback only (127.0.0.1:0), opaque path, per-session Bearer 토큰 인증.
 * pi의 native tool을 ACP CLI에 MCP 경로로 노출.
 *
 * FIFO 큐 방식: tools/call 핸들러는 직접 실행하지 않고 큐에서 대기.
 * pi agent-loop이 tool을 실행하고 결과를 resolveNextToolCall()로 전달.
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import http from "http";
import crypto from "crypto";

import { getLogAPI } from "../log/bridge.js";
import {
  getToolsForSession,
} from "./provider-tools.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/** JSON-RPC 2.0 요청 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 응답 */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** MCP CallToolResult 형식 */
export interface McpCallToolResult {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
}

/** FIFO 큐의 대기 중인 tool call */
interface PendingToolCall {
  toolName: string;
  toolCallId: string;
  resolve: (result: JsonRpcResponse) => void;
}

/** tools/call보다 먼저 도착한 결과 */
interface PendingToolResult {
  toolCallId: string;
  result: McpCallToolResult;
}

/** MCP tool call 도착 콜백 — provider가 등록, tools/call 수신 시 호출 */
export type ToolCallArrivedCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => string;

type JsonRpcPayload = JsonRpcResponse | JsonRpcResponse[] | null;

interface ProcessJsonRpcOptions {
  immediateResponse?: http.ServerResponse;
}

// ═══════════════════════════════════════════════════════════════════════════
// Module state — singleton
// ═══════════════════════════════════════════════════════════════════════════

/** HTTP 서버 인스턴스 */
let server: http.Server | null = null;

/** 서버 base URL */
let serverUrl: string | null = null;

/** opaque path — 외부 접근 차단용 */
let opaquePath: string | null = null;

/** 세션별 FIFO 큐 — MCP가 먼저 도달한 tool call 대기열 */
const pendingToolCalls = new Map<string, PendingToolCall[]>();

/** 세션별 pre-queued 결과 — pi result가 먼저 도달한 경우 */
const pendingResults = new Map<string, PendingToolResult[]>();

/** 세션별 MCP tool call 도착 콜백 — token 기준으로 격리 */
const toolCallArrivedCallbacks = new Map<string, ToolCallArrivedCallback>();

/** 현재 turn에서 tools/call을 받을 수 있는 세션 token */
const acceptingToolCalls = new Set<string>();

const JSON_CONTENT_TYPE = { "Content-Type": "application/json" } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Functions — 서버 lifecycle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * MCP 서버 기동.
 * 이미 실행 중이면 기존 URL 반환.
 *
 * @returns base URL (e.g., "http://127.0.0.1:12345/<opaque-path>")
 */
export async function startMcpServer(): Promise<string> {
  if (server && serverUrl) return serverUrl;

  const log = getLogAPI();
  opaquePath = `/${crypto.randomUUID()}`;

  return new Promise<string>((resolve, reject) => {
    const srv = http.createServer(handleRequest);
    // CLI의 MCP 타임아웃 방지 — carrier_sortie 등 장시간 도구를 위해 30분
    const THIRTY_MIN = 30 * 60 * 1000;
    srv.timeout = THIRTY_MIN;
    srv.keepAliveTimeout = THIRTY_MIN;
    srv.headersTimeout = THIRTY_MIN + 1000; // timeout보다 약간 높게
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("서버 바인딩 실패"));
        return;
      }
      server = srv;
      serverUrl = `http://127.0.0.1:${addr.port}${opaquePath}`;
      log.info("acp-provider", `MCP 서버 기동: port=${addr.port}`);
      resolve(serverUrl);
    });
    srv.on("error", (err) => {
      log.error("acp-provider", `MCP 서버 오류: ${err.message}`);
      reject(err);
    });
  });
}

/** MCP 서버 종료 */
export async function stopMcpServer(): Promise<void> {
  if (!server) return;
  const log = getLogAPI();

  // 모든 pending tool call 에러로 resolve
  for (const [token] of pendingToolCalls) {
    clearPendingForSession(token);
  }

  return new Promise<void>((resolve) => {
    server!.close(() => {
      log.info("acp-provider", "MCP 서버 종료");
      server = null;
      serverUrl = null;
      opaquePath = null;
      toolCallArrivedCallbacks.clear();
      resolve();
    });
    server!.closeAllConnections?.();
  });
}

/** MCP tool call 도착 콜백 등록/해제 — 세션 token 기준 격리 */
export function setOnToolCallArrived(token: string, cb: ToolCallArrivedCallback | null): void {
  if (cb) {
    toolCallArrivedCallbacks.set(token, cb);
  } else {
    toolCallArrivedCallbacks.delete(token);
    acceptingToolCalls.delete(token);
  }
}

/** 세션 token의 tools/call 수락 여부 설정 */
export function setToolCallAcceptance(token: string, accepting: boolean): void {
  if (accepting) {
    acceptingToolCalls.add(token);
  } else {
    acceptingToolCalls.delete(token);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Functions — FIFO 큐 관리
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세션의 다음 대기 중인 MCP tool call에 결과를 전달.
 * FIFO 순서로 resolve. 대기 중인 tool call이 없으면 pre-queue.
 */
export function resolveNextToolCall(
  token: string,
  toolCallId: string,
  result: McpCallToolResult,
): void {
  const log = getLogAPI();
  const queue = pendingToolCalls.get(token);

  if (queue && queue.length > 0) {
    const pending = queue[0]!;
    if (pending.toolCallId !== toolCallId) {
      throw new Error(
        `MCP FIFO head mismatch: expected=${pending.toolCallId} actual=${toolCallId}`,
      );
    }
    queue.shift();
    if (queue.length === 0) pendingToolCalls.delete(token);
    log.debug("acp-provider", `FIFO resolve: ${pending.toolName} (${toolCallId})`);
    pending.resolve(makeResult(null, result));
  } else {
    // MCP가 아직 도착하지 않음 — toolCallId와 함께 pre-queue
    let preQueue = pendingResults.get(token);
    if (!preQueue) {
      preQueue = [];
      pendingResults.set(token, preQueue);
    }
    preQueue.push({ toolCallId, result });
    log.debug("acp-provider", `FIFO pre-queue result (${preQueue.length} pending, id=${toolCallId})`);
  }
}

/** 세션의 FIFO 큐에 대기 중인 tool call이 있는지 확인 */
export function hasPendingToolCall(token: string): boolean {
  const queue = pendingToolCalls.get(token);
  return !!queue && queue.length > 0;
}

/** 세션의 모든 pending tool call 에러로 resolve + pre-queued 결과 정리 */
export function clearPendingForSession(token: string): void {
  const queue = pendingToolCalls.get(token);
  if (queue) {
    for (const pending of queue) {
      pending.resolve(makeResult(null, {
        content: [{ type: "text", text: "세션 종료됨" }],
        isError: true,
      }));
    }
    pendingToolCalls.delete(token);
  }
  pendingResults.delete(token);
  acceptingToolCalls.delete(token);
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP 요청 처리
// ═══════════════════════════════════════════════════════════════════════════

/** HTTP 요청 핸들러 */
function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const log = getLogAPI();

  // ── opaque path 검증 ──
  if (req.url !== opaquePath) {
    res.writeHead(404);
    res.end();
    return;
  }

  // ── POST only ──
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }

  // ── Bearer 토큰 추출 ──
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // ── 요청 본문 읽기 ──
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    try {
      const body = Buffer.concat(chunks).toString("utf-8");
      const parsed = JSON.parse(body);
      const shouldFlushHeaders = hasToolsCallRequest(parsed);

      if (shouldFlushHeaders) {
        res.writeHead(200, JSON_CONTENT_TYPE);
        res.flushHeaders();
      }

      if (Array.isArray(parsed)) {
        const results: (JsonRpcResponse | null)[] = [];
        const promises: Promise<void>[] = [];
        for (const item of parsed) {
          promises.push(
            processJsonRpc(item, token).then((result) => {
              results.push(result);
            }),
          );
        }
        Promise.all(promises)
          .then(() => {
            const filtered = results.filter((r): r is JsonRpcResponse => r !== null);
            sendJsonRpcPayload(res, filtered.length === 0 ? null : filtered, shouldFlushHeaders);
          })
          .catch((err) => {
            log.error("acp-provider", `MCP 배치 처리 실패: ${(err as Error).message}`);
            sendJsonRpcPayload(res, makeError(null, -32603, "Internal error"), shouldFlushHeaders);
          });
      } else {
        const options = shouldFlushHeaders && isToolsCallMethod(parsed)
          ? { immediateResponse: res }
          : undefined;

        processJsonRpc(parsed, token, options)
          .then((result) => {
            if (res.writableEnded) return;
            sendJsonRpcPayload(res, result, shouldFlushHeaders);
          })
          .catch((err) => {
            log.error("acp-provider", `MCP 요청 처리 실패: ${(err as Error).message}`);
            if (res.writableEnded) return;
            sendJsonRpcPayload(res, makeError(null, -32603, "Internal error"), shouldFlushHeaders);
          });
      }
    } catch (err) {
      log.error("acp-provider", `MCP 요청 파싱 실패: ${(err as Error).message}`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }));
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 메서드 디스패치
// ═══════════════════════════════════════════════════════════════════════════

/** 개별 JSON-RPC 요청 처리 — notification이면 null 반환 */
async function processJsonRpc(
  req: JsonRpcRequest,
  token: string,
  options?: ProcessJsonRpcOptions,
): Promise<JsonRpcResponse | null> {
  const log = getLogAPI();
  const { method, id, params } = req;

  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return makeResult(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "pi-tools", version: "1.0.0" },
      });

    case "notifications/initialized":
      return null;

    case "tools/list": {
      const tools = getToolsForSession(token);
      const mcpTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return makeResult(id, { tools: mcpTools });
    }

    case "tools/call": {
      const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!p?.name) {
        return makeError(id, -32602, "tool name 누락");
      }

      const tools = getToolsForSession(token);
      const tool = tools.find((t) => t.name === p.name);
      if (!tool) {
        return makeError(id, -32602, `tool을 찾을 수 없습니다: ${p.name}`);
      }

      log.debug("acp-provider", `MCP tool call 수신 (FIFO 큐 대기): ${p.name}`);

      // 콜백으로 event-mapper에 알림 — token 기준으로 올바른 세션에 전달
      const cb = toolCallArrivedCallbacks.get(token);
      if (!cb) {
        return makeError(id, -32000, "tool call router가 연결되지 않았습니다");
      }
      if (!acceptingToolCalls.has(token)) {
        return makeError(id, -32000, "현재 ACP turn이 종료되어 tool call을 받을 수 없습니다");
      }
      const toolCallId = cb(p.name, p.arguments ?? {});

      // pre-queued 결과가 현재 toolCallId와 일치하면 즉시 반환
      const preQueue = pendingResults.get(token);
      if (preQueue && preQueue.length > 0) {
        const pendingResult = preQueue[0]!;
        if (pendingResult.toolCallId === toolCallId) {
          preQueue.shift();
          if (preQueue.length === 0) pendingResults.delete(token);
          log.debug("acp-provider", `FIFO pre-queued 결과 반환: ${p.name} (${toolCallId})`);
          return makeResult(id, pendingResult.result);
        }
        return makeError(
          id,
          -32000,
          `MCP FIFO pre-queue mismatch: expected=${toolCallId} actual=${pendingResult.toolCallId}`,
        );
      }

      // FIFO 큐에 넣고 대기 — pi agent-loop이 결과를 전달할 때까지 HTTP 응답 보류
      return new Promise<JsonRpcResponse>((resolve) => {
        let queue = pendingToolCalls.get(token);
        if (!queue) {
          queue = [];
          pendingToolCalls.set(token, queue);
        }
        queue.push({
          toolName: p.name!,
          toolCallId,
          resolve: (result) => {
            // JSON-RPC id를 올바르게 설정
            const payload = { ...result, id: id ?? null };
            if (options?.immediateResponse && !options.immediateResponse.writableEnded) {
              options.immediateResponse.end(JSON.stringify(payload));
            }
            resolve(payload);
          },
        });
      });
    }

    default:
      if (isNotification) return null;
      return makeError(id, -32601, `지원하지 않는 메서드: ${method}`);
  }
}

/** JSON-RPC 성공 응답 생성 */
function makeResult(
  id: string | number | null | undefined,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

/** JSON-RPC 에러 응답 생성 */
function makeError(
  id: string | number | null | undefined,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function hasToolsCallRequest(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => isToolsCallMethod(item));
  }
  return isToolsCallMethod(value);
}

function isToolsCallMethod(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as JsonRpcRequest).method === "tools/call";
}

function sendJsonRpcPayload(
  res: http.ServerResponse,
  payload: JsonRpcPayload,
  headersFlushed: boolean,
): void {
  if (res.writableEnded) return;

  if (payload === null) {
    if (headersFlushed) {
      res.end();
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (!headersFlushed) {
    res.writeHead(200, JSON_CONTENT_TYPE);
  }
  res.end(JSON.stringify(payload));
}
