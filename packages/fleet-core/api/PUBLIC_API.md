# Fleet Core Public API

This contract is the external surface for `@sbluemin/fleet-core`. It is frozen for the productization migration and is implemented through the root barrel plus documented subpath exports.

## Runtime

- `createFleetCoreRuntime(options: FleetCoreRuntimeOptions): FleetCoreRuntime`
- `FleetCoreRuntimeOptions = { dataDir: string; ports: FleetHostPorts; backend?: BackendAdapter; }`
- `FleetCoreRuntime = { agent; agentRequest; jobs; carriers; admiral; metaphor; experimentalWiki?; grandFleet?; toolRegistry; mcp; shutdown(): Promise<void>; }`

`createFleetCoreRuntime` is the canonical host composition entry point. It runs `initRuntime(dataDir)`, `initStore(dataDir)`, and, when `ports.serviceStatus` is provided, `initServiceStatus(ports.serviceStatus)`. If `ports.serviceStatus` is absent, it calls `resetServiceStatus()` to ensure a clean state.

The returned `shutdown()` method is responsible for cleaning up the agent and resetting service status callbacks/timers via `resetServiceStatus()`.

## Agent Runtime

- `createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime`
- `AgentRuntimeOptions = { dataDir: string; ports: FleetHostPorts; backend?: BackendAdapter; toolRegistry?: AgentToolRegistry; }`
- `AgentRuntime = { toolRegistry: AgentToolRegistry; mcp: McpRegistryAPI; agentRequest: AgentRequestService; shutdown(): Promise<void>; }`

## Agent Request Service

- Subpath: `@sbluemin/fleet-core/agent/request`
- `createAgentRequestService(options): AgentRequestService`
- `AgentRequestService`
- `UnifiedAgentRequestOptions`
- `UnifiedAgentBackgroundRequestOptions`
- `UnifiedAgentResult`
- `UnifiedAgentRequestStatus`

`AgentRequestService` owns unified-agent request orchestration in fleet-core. It wraps the existing executor contract, owns the bridge/streaming Run lifecycle, and returns the same `UnifiedAgentResult` field set consumed by Pi adapters: `status`, `responseText`, `sessionId`, `error`, `thinking`, `toolCalls`, and `blocks`.

## Tool Registry

- `AgentToolRegistry`
- `AgentToolSpec`
- `AgentToolCtx`
- `createAgentToolRegistry(): AgentToolRegistry`
- `FleetToolRegistryPorts`
- `createFleetToolRegistry(ports: FleetToolRegistryPorts): readonly AgentToolSpec[]`

The generic registry feeds both Pi tool registration and the in-process MCP server. `createFleetToolRegistry` exposes Fleet-owned tool specs for host adapters; hosts still own their registration sink, renderers, and push/UI wiring.

## Host Ports

- `FleetHostPorts`
- `FleetLogPort`
- `ServiceStatusCallbacks`
- `LlmClient`
- `LlmCompleteRequest`
- `LlmCompleteResult`

`LlmClient` is an injected port. fleet-core never imports `@mariozechner/pi-ai`.

### Agent Streaming Sink

- Subpath: `@sbluemin/fleet-core/streaming-sink`
- `AgentStreamingSink`
- `AgentColumnStream`
- `AgentColumnUpdate`
- `AgentColumnKey`
- `AgentColumnEndReason`

`AgentStreamingSink` is the host-owned column lifecycle port used by `AgentRequestService`. Hosts may implement `onColumnBegin`, `onColumnUpdate`, and `onColumnEnd`.

`onColumnBegin` may return an optional `AgentColumnStream` token (or a Promise resolving to one). If provided, this token is passed back to `onColumnEnd` for the same column, allowing hosts to preserve per-run state (like UI context or column indices) across the streaming lifecycle.

When these callbacks are omitted, fleet-core still records the streaming Run lifecycle and skips host column callbacks.

## Backend Adapter

- `BackendAdapter`
- `BackendSession`
- `BackendConnectOptions`
- `BackendRequest`
- `BackendResponse`

The adapter is structurally compatible with unified-agent without depending on its concrete implementation.

## MCP

- `createMcpServerForRegistry(registry, options): McpServerHandle`
- `McpRegistryAPI`
- `McpServerHandle`
- `McpServerOptions`
- `PendingToolCall`
- `PendingToolResult`

The MCP server subscribes through `registry.onChange` and does not poll.

## Adapter Types

- `ArchiveBlock`
- `CarrierJobLaunchResponse`
- `CarrierJobSummary`
- `CompletionPushPayload`
- `JobArchive`

## Package Exports

- `.`
- `./agent`
- `./agent/request`
- `./agent/provider-types`
- `./agent/types`
- `./agent/runtime`
- `./agent/session-store`
- `./agent/session-resume-utils`
- `./agent/pool`
- `./agent/executor`
- `./agent/tool-snapshot`
- `./agent/provider-mcp`
- `./agent/log-port`
- `./streaming-sink`
- `./job`
- `./carrier`
- `./squadron`
- `./taskforce`
- `./carrier-jobs`
- `./store`
- `./push`
- `./bridge`
- `./operation`
- `./admiral`
- `./metaphor`
- `./grand-fleet`
- `./experimental-wiki`

Deep imports through `./internal/*` or `./src/*` are not part of this API.

## Stable Subpath Additions

- `@sbluemin/fleet-core/admiral`: `HEADER_MAX_LENGTH`, `RequestDirectiveParams`, directive schemas/types, `validateQuestions`, `clampHeader`, `hasPreview`, and `errorResult` for `request_directive`.
- `@sbluemin/fleet-core/grand-fleet`: grand-fleet tool parameter schemas plus name, label, and description constants for `grand_fleet_deploy`, `grand_fleet_dispatch`, `grand_fleet_recall`, `grand_fleet_broadcast`, `grand_fleet_status`, and `mission_report`.
- `@sbluemin/fleet-core/agent/request`: `AgentRequestService`, `createAgentRequestService`, and unified-agent request/result types.
- `@sbluemin/fleet-core/streaming-sink`: host column lifecycle port types for agent streaming.
- `FleetHostPorts.appendStreamBlock`, `syncPanelColumn`, and `endStreamColumn` are deprecated for one public-API cycle. They will be removed in the next minor public-API cycle; implement `streamingSink` instead.
