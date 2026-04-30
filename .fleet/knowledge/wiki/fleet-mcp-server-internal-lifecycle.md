---
id: "fleet-mcp-server-internal-lifecycle"
title: "MCP server lifecycle is internal to fleet-core — startServer/stopServer NOT exposed"
tags: ["fleet-core", "fleet-services", "mcp", "invariant", "lifecycle"]
created: "2026-04-30T17:58:21.704Z"
updated: "2026-04-30T17:58:21.704Z"
version: 1
rawSourceRef: "raw/2026-04-30-fleet-mcp-server-internal-lifecycle-source.md"
---
## Invariant

The MCP HTTP server defined in `packages/fleet-core/src/admiral/_shared/mcp.ts` (FIFO queue, token isolation, HTTP-hold) is owned exclusively by fleet-core. External callers MUST NOT start or stop it. The doctrine, fixed in round 3 of the destructive cleansing operation, is:

> McpServer를 fleet-core 외부에서 생성 및 시작/종료를 제공하지 않을것임.

## Public surface

`FleetServices.mcp` (in `packages/fleet-core/src/public/fleet-services.ts`) exposes ONLY these methods:

- `url(): Promise<string>` — lazy auto-start. First call invokes `startMcpServer()`; subsequent calls return the cached URL promise.
- `setOnToolCallArrived(token, cb)`, `resolveNextToolCall(token, toolCallId, result)`, `hasPendingToolCall(token)`, `clearPendingForSession(token)` — per-session routing callbacks.
- `registerTools / getTools / getToolNames / removeTools / clearAllTools / computeToolHash / convertToolSchema` — tool snapshot management.

`startServer()` and `stopServer()` are intentionally absent from the public surface. They were removed in round 3 alongside `createMcpServerForRegistry`, `McpServerHandle`, `McpRegistryAPI`.

## Lifecycle automation

- **Start**: triggered by the first `fleet.mcp.url()` call. The cached promise is held in `cachedMcpUrlPromise` inside `fleet-services.ts`.
- **Stop**: `FleetCoreRuntimeContext.shutdown()` calls `shutdownFleetMcp()` which clears `cachedMcpUrlPromise` and invokes `stopMcpServer()`. Hosts MUST call `runtime.shutdown()` for clean teardown.

## How to apply

- If a consumer needs the MCP base URL (e.g. when spawning an ACP CLI with `--mcp-server <url>`), call `getFleetRuntime().fleet.mcp.url()`. Do NOT import `startMcpServer` from `admiral/_shared/mcp`.
- Never re-add `startServer` / `stopServer` to `FleetServices.mcp`. Hosts that "need to restart MCP" should restart the entire fleet runtime.
- Preserve the FIFO + per-token isolation + HTTP-hold invariants when modifying `admiral/_shared/mcp.ts` — these were carried over verbatim from the legacy `services/agent/provider/mcp.ts` and are load-bearing for ACP CLI tool routing.