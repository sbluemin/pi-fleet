import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../log/bridge.js", () => ({
  getLogAPI: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  resolveNextToolCall,
  setOnToolCallArrived,
  startMcpServer,
  stopMcpServer,
} from "./provider-mcp.js";
import {
  clearAllTools,
  registerToolsForSession,
  removeToolsForSession,
} from "./provider-tools.js";

describe("provider-mcp", () => {
  beforeEach(() => {
    clearAllTools();
  });

  afterAll(async () => {
    await stopMcpServer();
  });

  it("router가 정리된 세션의 늦은 tools/call을 즉시 거부한다", async () => {
    const token = "test-token-router-detached";
    const url = await startMcpServer();

    registerToolsForSession(token, [
      {
        name: "custom-tool",
        description: "custom",
        parameters: { type: "object", properties: {} },
      } as any,
    ]);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "custom-tool", arguments: {} },
      }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error.code).toBe(-32000);
    expect(String(body.error.message)).toContain("tool call router가 정리");

    removeToolsForSession(token);
    setOnToolCallArrived(token, null);
  });

  it("tools/call은 결과 전에도 헤더를 즉시 반환한다", async () => {
    const token = "test-token-immediate-header";
    const callback = vi.fn(() => "call-1");
    const url = await startMcpServer();

    registerToolsForSession(token, [
      {
        name: "custom-tool",
        description: "custom",
        parameters: { type: "object", properties: {} },
      } as any,
    ]);
    setOnToolCallArrived(token, callback);

    const response = await Promise.race([
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "custom-tool", arguments: {} },
        }),
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("헤더가 즉시 반환되지 않았습니다")), 250);
      }),
    ]);

    expect(response.status).toBe(200);
    expect(callback).toHaveBeenCalledTimes(1);

    resolveNextToolCall(token, "call-1", {
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });

    const body = await response.json();
    expect(body.result).toEqual({
      content: [{ type: "text", text: "ok" }],
      isError: false,
    });

    removeToolsForSession(token);
    setOnToolCallArrived(token, null);
  });

  it("배치 요청에 tools/call이 섞여 있어도 헤더를 즉시 반환한다", async () => {
    const token = "test-token-batch-header";
    const callback = vi.fn(() => "call-2");
    const url = await startMcpServer();

    registerToolsForSession(token, [
      {
        name: "custom-tool",
        description: "custom",
        parameters: { type: "object", properties: {} },
      } as any,
    ]);
    setOnToolCallArrived(token, callback);

    const response = await Promise.race([
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {},
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "custom-tool", arguments: {} },
          },
        ]),
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("배치 헤더가 즉시 반환되지 않았습니다")), 250);
      }),
    ]);

    expect(response.status).toBe(200);
    expect(callback).toHaveBeenCalledTimes(1);

    resolveNextToolCall(token, "call-2", {
      content: [{ type: "text", text: "batch-ok" }],
      isError: false,
    });

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        id: 2,
        result: {
          content: [{ type: "text", text: "batch-ok" }],
          isError: false,
        },
      }),
    ]));

    removeToolsForSession(token);
    setOnToolCallArrived(token, null);
  });
});
