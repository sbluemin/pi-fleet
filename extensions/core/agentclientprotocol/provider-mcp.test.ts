import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../log/bridge.js", () => ({
  getLogAPI: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  setOnToolCallArrived,
  setToolCallAcceptance,
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

  it("turn 종료 후 늦게 도착한 tools/call을 큐에 적재하지 않는다", async () => {
    const token = "test-token-stale";
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
    setToolCallAcceptance(token, false);

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
    expect(String(body.error.message)).toContain("현재 ACP turn이 종료");
    expect(callback).not.toHaveBeenCalled();

    removeToolsForSession(token);
    setOnToolCallArrived(token, null);
  });
});
