---
id: "fleet-core-runtime-context-shape"
title: "FleetCoreRuntimeContext shape after destructive cleansing — do not re-add removed fields"
tags: ["fleet-core", "public-api", "doctrine", "invariant"]
created: "2026-04-30T17:59:31.228Z"
updated: "2026-04-30T17:59:31.228Z"
version: 1
rawSourceRef: "raw/2026-04-30-fleet-core-runtime-context-shape-source.md"
---
## Final shape

```ts
interface FleetCoreRuntimeContext {
  fleet: FleetServices;
  grandFleet: GrandFleetServices;
  metaphor: FleetMetaphorServices;
  jobs: FleetJobServices;
  log: FleetLogServices;
  settings: FleetSettingsServices;
  shutdown(): Promise<void>;
}

createFleetCoreRuntime(options: {
  dataDir: string;
  ports: FleetServicesPorts;
}): FleetCoreRuntimeContext;
```

`FleetServicesPorts`:

```ts
interface FleetServicesPorts {
  readonly logDebug: (category: string, message: string, options?: unknown) => void;
  readonly runAgentRequestBackground: (options: unknown) => Promise<unknown>;
  readonly enqueueCarrierCompletionPush: (payload: { jobId: string; summary: string }) => void;
  readonly streamingSink?: { onAgentStreamEvent(event: unknown): void | Promise<void> };
}
```

## Removed fields — DO NOT re-add

The following fields were intentionally removed during the destructive cleansing operation. Re-adding any of them is a doctrine violation:

- `agent` (was `FleetAgentServices`) — removed in round 2. Agent execution is internal; consumers wanting `executeWithPool` / `executeOneShot` import from `@sbluemin/fleet-core/admiral/agent-runtime` directly.
- `toolRegistry` (was `FleetToolRegistryServices`) — removed in round 3. Tool specs are auto-built by fleet-services and exposed as `fleet.tools` (lazy getter).
- `mcp` (was `McpRegistryAPI`) — removed in round 3. MCP access is now `fleet.mcp` (a member of `FleetServices`, not a runtime-context field).

## Removed types — also DO NOT re-introduce

`FleetAgentServices`, `FleetAgentRuntimeHost`, `BackendAdapter`, `BackendConnectOptions`, `BackendSession`, `AgentStreamingSink`, `FleetHostPorts`, `UnifiedAgentRequestOptions`, `UnifiedAgentBackgroundRequestOptions`, `UnifiedAgentRequestStatus`, `UnifiedAgentResult`, `FleetToolRegistryServices`, `FleetToolRegistryPorts`, `AgentToolRegistry`, `McpRegistryAPI`, `McpServerHandle`, `McpServerOptions`, `PendingToolCall`, `PendingToolResult`, `executeAgentCore`, `createAgentServices`, `createAgentRequestService`, `createAgentToolRegistry`, `createFleetToolRegistry`, `createMcpServerForRegistry`, `createToolRegistryServices`, `UnifiedFleetAgentClientAdapter`, all `Fleet*` prefixed wrapper types over unified-agent (`FleetAgentClient`, `FleetAcpToolCall`, etc.).

These were wrappers, double-wrappers, or middle-layers over `@sbluemin/unified-agent`. The cleansing doctrine forbids reintroducing them: consumers MUST import unified-agent types directly (`IUnifiedAgentClient`, `AcpToolCall`, `AcpContentBlock`, `UnifiedClientEvents`, `UnifiedAgent`, etc.).

## How to add new functionality

- New domain service: add to `FleetCoreRuntimeContext` only if it is genuinely a new orthogonal domain (like `metaphor`, `jobs`). Most additions belong inside `FleetServices`.
- New ports: extend `FleetServicesPorts` and document the host-side responsibility.
- New tool spec: add to `buildFleetToolSpecs()` in `fleet-services.ts`. The lazy getter contract auto-exposes it.
- Wrappers around unified-agent: not allowed. If you find yourself writing `class FleetX implements IUnifiedAgentClient`, stop and reconsider.