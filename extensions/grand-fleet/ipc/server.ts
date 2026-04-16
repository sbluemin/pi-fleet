/**
 * Admiralty가 Fleet 연결을 받아 JSON-RPC Request/Notification을 처리하는
 * Unix Domain Socket 서버를 제공한다.
 */
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

import {
  createFramer,
  sendMessage,
  isRequest,
  isNotification,
  createJsonRpcResponse,
  createJsonRpcErrorResponse,
} from "./protocol.js";
import type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
} from "../types.js";
import { getLogAPI } from "../../core/log/bridge.js";

/** Admiralty → Fleet 방향의 메서드 핸들러 */
type RequestHandler = (
  params: Record<string, unknown>,
  fleetSocket: net.Socket,
) => Promise<unknown>;

/** Fleet → Admiralty 방향의 Notification 핸들러 */
type NotificationHandler = (
  params: Record<string, unknown>,
  fleetSocket: net.Socket,
) => void;

const SOCKET_PERMISSION = 0o600;
const REQUEST_TIMEOUT_MS = 30_000;

export class AdmiraltyServer {
  private server: net.Server | null = null;
  private connections = new Set<net.Socket>();
  private requestHandlers = new Map<string, RequestHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /** 메서드 핸들러 등록 (Request) */
  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  /** 메서드 핸들러 등록 (Notification) */
  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  /** 서버 시작 */
  async start(): Promise<void> {
    const log = getLogAPI();
    removeSocketFileIfExists(this.socketPath);
    ensureSocketDirectory(this.socketPath);
    log.debug("grand-fleet:ipc", `서버 시작: ${this.socketPath}`);

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.connections.add(socket);
        log.info("grand-fleet:ipc", `Fleet 연결 수립 (활성 연결: ${this.connections.size})`);

        createFramer(
          socket,
          (msg) => this.handleMessage(msg, socket),
          (err) => log.error("grand-fleet:ipc", `프레이밍 오류: ${err.message}`),
        );

        socket.on("close", () => {
          this.connections.delete(socket);
          log.info("grand-fleet:ipc", `Fleet 연결 종료 (활성 연결: ${this.connections.size})`);
        });

        socket.on("error", (err) => {
          log.error("grand-fleet:ipc", `소켓 오류: ${err.message}`);
          this.connections.delete(socket);
        });
      });

      this.server.on("error", reject);
      this.server.listen(this.socketPath, () => {
        fs.chmodSync(this.socketPath, SOCKET_PERMISSION);
        log.info("grand-fleet:ipc", `Admiralty 서버 리스닝: ${this.socketPath}`);
        resolve();
      });
    });
  }

  /** 특정 소켓에 Request 전송 */
  async sendRequest(
    socket: net.Socket,
    method: string,
    params: Record<string, unknown>,
    id: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeListener("data", onData);
        reject(new Error(`Request 타임아웃: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      const onData = (chunk: Buffer) => {
        try {
          const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
          for (const line of lines) {
            const response = parseResponseLine(line);
            if (!response || response.id !== id) continue;

            clearTimeout(timeout);
            socket.removeListener("data", onData);

            if (response.error) {
              reject(new Error(response.error.message));
              return;
            }

            resolve(response.result);
            return;
          }
        } catch {
          // createFramer가 정상 파싱 경로를 담당하므로 여기서는 무시한다.
        }
      };

      socket.on("data", onData);
      sendMessage(socket, { jsonrpc: "2.0", method, params, id });
    });
  }

  /** 서버 종료 */
  async close(): Promise<void> {
    const log = getLogAPI();
    log.info("grand-fleet:ipc", `서버 종료 (활성 연결 ${this.connections.size}개 해제)`);
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (!this.server) {
        removeSocketFileIfExists(this.socketPath);
        resolve();
        return;
      }

      this.server.close(() => {
        removeSocketFileIfExists(this.socketPath);
        this.server = null;
        resolve();
      });
    });
  }

  /** 수신 메시지 처리 */
  private async handleMessage(
    msg: JsonRpcMessage,
    socket: net.Socket,
  ): Promise<void> {
    if (isRequest(msg)) {
      await this.handleRequestMessage(msg, socket);
      return;
    }

    if (isNotification(msg)) {
      this.handleNotificationMessage(msg, socket);
    }
  }

  /** Request 메시지를 핸들러에 위임하고 응답을 반환한다. */
  private async handleRequestMessage(
    msg: JsonRpcRequest,
    socket: net.Socket,
  ): Promise<void> {
    const log = getLogAPI();
    const handler = this.requestHandlers.get(msg.method);
    if (!handler) {
      log.warn("grand-fleet:ipc", `알 수 없는 메서드: ${msg.method}`);
      sendMessage(
        socket,
        createJsonRpcErrorResponse(
          msg.id,
          -32601,
          `Method not found: ${msg.method}`,
        ),
      );
      return;
    }

    log.debug("grand-fleet:ipc", `Request 수신: ${msg.method} (id=${msg.id})`);
    try {
      const result = await handler(msg.params ?? {}, socket);
      sendMessage(socket, createJsonRpcResponse(msg.id, result));
      log.debug("grand-fleet:ipc", `Request 완료: ${msg.method} (id=${msg.id})`);
    } catch (err) {
      log.error("grand-fleet:ipc", `Request 실패: ${msg.method} — ${toErrorMessage(err)}`);
      sendMessage(
        socket,
        createJsonRpcErrorResponse(msg.id, -32603, toErrorMessage(err)),
      );
    }
  }

  /** Notification 메시지를 핸들러에 위임한다. */
  private handleNotificationMessage(
    msg: JsonRpcNotification,
    socket: net.Socket,
  ): void {
    const handler = this.notificationHandlers.get(msg.method);
    if (!handler) return;
    getLogAPI().debug("grand-fleet:ipc", `Notification 수신: ${msg.method}`);
    handler(msg.params ?? {}, socket);
  }
}

function ensureSocketDirectory(socketPath: string): void {
  const dir = path.dirname(socketPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removeSocketFileIfExists(socketPath: string): void {
  if (!fs.existsSync(socketPath)) return;
  fs.unlinkSync(socketPath);
}

function parseResponseLine(line: string): {
  id?: number | string;
  result?: unknown;
  error?: { message: string };
} | null {
  return JSON.parse(line) as {
    id?: number | string;
    result?: unknown;
    error?: { message: string };
  };
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
