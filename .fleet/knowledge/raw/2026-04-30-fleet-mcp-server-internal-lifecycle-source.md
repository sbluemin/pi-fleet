---
id: "fleet-mcp-server-internal-lifecycle-source"
created: "2026-04-30T17:58:21.704Z"
sourceType: "inline"
title: "3차 cleansing — McpServer 외부 차단 결정"
tags: ["fleet-core", "fleet-services", "mcp", "invariant", "lifecycle"]
---
Round 3 cleansing decision (대원수 명령 4번):
"McpServer를 fleet-core외부에서 생성 및 시작/종료를 제공하지 않을것임."

Implementation in packages/fleet-core/src/public/fleet-services.ts:
```ts
let cachedMcpUrlPromise: Promise<string> | null = null;

function getFleetMcpUrl(): Promise<string> {
  cachedMcpUrlPromise ??= startMcpServer();
  return cachedMcpUrlPromise;
}

export async function shutdownFleetMcp(): Promise<void> {
  cachedMcpUrlPromise = null;
  await stopMcpServer();
}
```

Removed in this round:
- createMcpServerForRegistry
- McpServerHandle
- McpRegistryAPI
- McpServerOptions
- FleetCoreRuntimeContext.mcp field

pi-fleet-extension consumer change:
- provider-stream.ts: getFleetRuntime().fleet.mcp.startServer() → getFleetRuntime().fleet.mcp.url()
- stopServer() call removed entirely (auto on shutdown)