# Fleet Core Public API

This contract is the external surface for `@sbluemin/fleet-core`. It is frozen for the productization migration and is implemented through the root barrel plus documented subpath exports.

## Runtime

- `createFleetCoreRuntime(options: FleetCoreRuntimeOptions): FleetCoreRuntime`
- `FleetCoreRuntimeOptions = { dataDir: string; ports: FleetHostPorts; backend?: BackendAdapter; }`
- `FleetCoreRuntime = { agent; agentRequest; jobs; carriers; admiral; metaphor; experimentalWiki?; grandFleet?; toolRegistry; mcp; coreServices: { settings; }; shutdown(): Promise<void>; }`

`createFleetCoreRuntime` is the canonical host composition entry point. It initializes the runtime-owned state (data directory, storage, and settings service) and, when `ports.serviceStatus` is provided, configures the service status tracking. If `ports.serviceStatus` is absent, it ensures a clean service status state.

The returned `shutdown()` method is responsible for cleaning up the agent, resetting the runtime-owned settings service, and cleaning up service status callbacks/timers.

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

`AgentRequestService` owns unified-agent request orchestration in fleet-core. It wraps the existing executor contract, owns the bridge/run-stream Run lifecycle, and returns the same `UnifiedAgentResult` field set consumed by Pi adapters: `status`, `responseText`, `sessionId`, `error`, `thinking`, `toolCalls`, and `blocks`.

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

## Bridge Run Stream

- Subpath: `@sbluemin/fleet-core/bridge/run-stream`
- `BridgeStateStorage`
- `configureBridgeStateStorage(storage: BridgeStateStorage | null): void`
- `getBridgeStateStorage(): BridgeStateStorage`
- `readBridgeState<T>(key: string): T | undefined`
- `writeBridgeState<T>(key: string, value: T): T`
- `createRun(...)`
- `updateRunStatus(...)`
- `finalizeRun(...)`
- `resetRuns()`
- `getVisibleRun()`
- `getRunById(runId)`

The run-stream layer owns host-agnostic per-run stream state and state persistence. It defaults to `globalThis` for compatibility but allows host injection through `configureBridgeStateStorage`.

### Bridge Carrier Panel

- Subpath: `@sbluemin/fleet-core/bridge/carrier-panel`
- `registerSortieJob(...)`
- `registerSquadronJob(...)`
- `registerTaskforceJob(...)`
- `finalizeJob(...)`
- `getActiveJobs()`
- `PanelJobViewModel`
- `PanelTrackViewModel`
- `buildPanelViewModel(jobs, options?): PanelJobViewModel[]`
- `buildPanelTrackViewModel(track, maxBlocks?): PanelTrackViewModel`

This subpath owns host-agnostic carrier panel job/track state plus deterministic data snapshots for host renderers (e.g., Pi TUI) to consume. It contains no UI mounting or rendering code.

### Bridge Control

- Subpath: `@sbluemin/fleet-core/bridge/carrier-control`
- `StatusOverlayController`
- `CarrierOverlayCallbacks`
- `CarrierStatusEntry`
- `CliModelInfo`
- `CliTypeChangeResult`
- `ResolvedCliSelection`

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
- `./agent/thinking-level-patch`
- `./agent/log-port`
- `./agent/service-status`
- `./constants`
- `./streaming-sink`
- `./job`
- `./carrier`
- `./carrier/personas`
- `./squadron`
- `./taskforce`
- `./carrier-jobs`
- `./store`
- `./gfleet`
- `./gfleet/ipc`
- `./gfleet/formation`
- `./bridge/run-stream`
- `./bridge/carrier-panel`
- `./bridge/carrier-control`
- `./admiral`
- `./admiral/protocols`
- `./admiral/standing-orders`
- `./admiral/tool-prompt-manifest`
- `./metaphor`
- `./metaphor/operation-name`
- `./metaphor/directive-refinement`
- `./core-services`
- `./core-services/settings`
- `./core-services/keybind`
- `./core-services/log`

Deep imports through `./internal/*` or `./src/*` are not part of this API.

## Stable Subpath Additions

- `@sbluemin/fleet-core/admiral`: `HEADER_MAX_LENGTH`, `RequestDirectiveParams`, directive schemas/types, `validateQuestions`, `clampHeader`, `hasPreview`, and `errorResult` for `request_directive`.
- `@sbluemin/fleet-core/agent/request`: `AgentRequestService`, `createAgentRequestService`, and unified-agent request/result types.
- `@sbluemin/fleet-core/agent/service-status`: service-status store and runtime lifecycle helpers for host-visible provider status.
- `@sbluemin/fleet-core/constants`: shared Fleet constants for colors, labels, and runtime display contracts.
- `@sbluemin/fleet-core/streaming-sink`: host column lifecycle port types for agent streaming.
- `@sbluemin/fleet-core/carrier/personas`: default carrier persona definitions and persona registration helpers.
- `@sbluemin/fleet-core/gfleet`: Grand Fleet domain prompt builders, reporter helpers, status-source logic, text sanitization, tool specs, and shared types.
- `@sbluemin/fleet-core/gfleet/ipc`: Grand Fleet JSON-RPC protocol contracts and message helpers.
- `@sbluemin/fleet-core/gfleet/formation`: Grand Fleet tmux formation helpers.
- `@sbluemin/fleet-core/admiral/protocols`: protocol catalogs and active-protocol prompt builders for Admiral orchestration.
- `@sbluemin/fleet-core/admiral/standing-orders`: always-on standing-order prompt builders and related doctrine helpers.
- `@sbluemin/fleet-core/admiral/tool-prompt-manifest`: tool prompt manifest registration and lookup helpers.
- `@sbluemin/fleet-core/metaphor/operation-name`: operation-name prompt builders, schemas, and runtime helpers.
- `@sbluemin/fleet-core/metaphor/directive-refinement`: directive-refinement prompt builders, schemas, and runtime helpers.
- `@sbluemin/fleet-core/core-services`: shared pure service barrels for Pi adapter consumption.
- `@sbluemin/fleet-core/core-services/settings`: runtime-owned settings registry/store contracts and helpers. Setter-style provider APIs (settings-port) have been removed in favor of runtime-owned singletons.
- `@sbluemin/fleet-core/core-services/keybind`: keybind registry/store contracts and helpers.
- `@sbluemin/fleet-core/core-services/log`: log store contracts and file-backed helpers.
- `FleetHostPorts.appendStreamBlock`, `syncPanelColumn`, and `endStreamColumn` are deprecated for one public-API cycle. They will be removed in the next minor public-API cycle; implement `streamingSink` instead.
