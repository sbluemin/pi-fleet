# Fleet Core Public API

This contract is the external surface for `@sbluemin/fleet-core`. It is frozen for the productization migration and is implemented through the root barrel plus documented subpath exports.

## Runtime

- `createFleetCoreRuntime(options: FleetCoreRuntimeOptions): FleetCoreRuntime`
- `FleetCoreRuntimeOptions = { dataDir: string; ports: FleetHostPorts; backend?: BackendAdapter; }`
- `FleetCoreRuntime = { agent; coreServices: { settings; }; agentRequest; jobs; carriers; admiral; metaphor; experimentalWiki?: unknown; grandFleet?: GrandFleetServices; toolRegistry: AgentToolRegistry; mcp: McpRegistryAPI; shutdown(): Promise<void>; }`

`createFleetCoreRuntime` is the canonical host composition entry point. It initializes the runtime-owned state (data directory, storage, and settings service). The `grandFleet` property reflects the internalized `admiralty` domain.

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

`AgentRequestService` owns unified-agent request orchestration in fleet-core. It wraps the existing executor contract and returns semantic result fields consumed by Pi adapters: `status`, `responseText`, `sessionId`, `error`, `thinking`, `toolCalls`, and normalized `streamData` when available. Rendering remains host-owned.

## Agent Normalized Stream Contract

- Subpath: `@sbluemin/fleet-core/agent/types`
- `ColBlock`
- `ColStatus`
- `CollectedStreamData`
- `AgentStreamEvent`
- `AgentStreamKey`
- `AgentStreamToolEvent`
- `AgentStreamEndReason`
- `ExecuteResult`

`ColBlock`, `ColStatus`, and `CollectedStreamData` are canonical agent-owned contracts. `executeOneShot`, `executeWithPool`, and `UnifiedAgentResult` expose `streamData` so consumers can render from Fleet-normalized stream data without importing raw unified-agent structures. `AgentStreamKey.requestId` correlates foreground stream events for a single request; semantic tool stream events do not expose raw executor output.

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
- `AgentStreamEvent`
- `AgentStreamKey`
- `AgentStreamToolEvent`
- `AgentStreamEndReason`

`AgentStreamingSink` is the host-owned semantic event port used by `AgentRequestService`. Hosts implement `onAgentStreamEvent(event)` and may accumulate their own rendering state from `request_begin`, `status`, `message`, `thought`, `tool`, `error`, and `request_end` events. The event types are re-exported from the canonical agent stream contract. Foreground events emitted by `AgentRequestService` include a per-request `AgentStreamKey.requestId`; `request_end` carries normalized `streamData` for both executor results and executor-error fallback paths.

When this callback is omitted, fleet-core still executes the request and skips host streaming events. `runBackground` keeps its existing behavior and does not emit foreground panel lifecycle events.

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

- Subpath: `@sbluemin/fleet-core/admiral/bridge/run-stream`
- `ColBlock`
- `ColStatus`
- `CollectedStreamData`
- `BridgeStateStorage`
- `configureBridgeStateStorage(storage: BridgeStateStorage | null): void`
- `getBridgeStateStorage(): BridgeStateStorage`
- `readBridgeState<T>(key: string): T | undefined`
- `writeBridgeState<T>(key: string, value: T): T`
- `createRun(...)`
- `updateRunStatus(...)`
- `updateRunStatusByRunId(...)`
- `finalizeRun(...)`
- `finalizeRunByRunId(...)`
- `appendTextBlockByRunId(...)`
- `appendThoughtBlockByRunId(...)`
- `upsertToolBlockByRunId(...)`
- `resetRuns()`
- `getVisibleRun()`
- `getRunById(runId)`

The run-stream layer owns host-agnostic per-run stream state and state persistence. It defaults to `globalThis` for compatibility but allows host injection through `configureBridgeStateStorage`. `ColBlock`, `ColStatus`, and `CollectedStreamData` remain available here as compatibility re-exports from `@sbluemin/fleet-core/agent/types`.

### Bridge Carrier Panel

- Subpath: `@sbluemin/fleet-core/admiral/bridge/carrier-panel`
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

- Subpath: `@sbluemin/fleet-core/admiral/bridge/carrier-control`
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
- `./agent/provider-client`
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
- `./carrier-jobs`
- `./admiral/carrier`
- `./admiral/carrier/personas`
- `./admiral/squadron`
- `./admiral/taskforce`
- `./admiral/store`
- `./admiral/bridge/run-stream`
- `./admiral/bridge/carrier-panel`
- `./admiral/bridge/carrier-control`
- `./admiral`
- `./admiral/protocols`
- `./admiral/protocols/standing-orders`
- `./services/tool-registry`
- `./metaphor`
- `./metaphor/operation-name`
- `./metaphor/directive-refinement`
- `./services`
- `./services/settings`
- `./services/keybind`
- `./services/log`
- `./admiralty`
- `./admiralty/ipc`

Deep imports through `./internal/*` or `./src/*` are not part of this API.

## Stable Subpath Additions

- `@sbluemin/fleet-core/admiral`: `HEADER_MAX_LENGTH`, `RequestDirectiveParams`, directive schemas/types, `validateQuestions`, `clampHeader`, `hasPreview`, and `errorResult` for `request_directive`.
- `@sbluemin/fleet-core/agent/request`: `AgentRequestService`, `createAgentRequestService`, and unified-agent request/result types.
- `@sbluemin/fleet-core/agent/types`: canonical normalized stream contracts, agent status, executor result, and service-status types.
- `@sbluemin/fleet-core/agent/provider-client`: provider-facing unified-agent adapter functions and shared provider client/event/config types for Pi adapters.
- `@sbluemin/fleet-core/agent/service-status`: service-status store and runtime lifecycle helpers for host-visible provider status.
- `@sbluemin/fleet-core/constants`: shared Fleet constants for colors, labels, and runtime display contracts.
- `@sbluemin/fleet-core/streaming-sink`: host semantic event port types for agent streaming.
- `@sbluemin/fleet-core/admiral/carrier`: carrier registry, prompt builders, sortie schemas, and runtime framework helpers.
- `@sbluemin/fleet-core/admiral/carrier/personas`: default carrier persona definitions and persona registration helpers.
- `@sbluemin/fleet-core/admiral/squadron`: Squadron prompt/schema/runtime helpers.
- `@sbluemin/fleet-core/admiral/taskforce`: Task Force prompt/schema/runtime helpers.
- `@sbluemin/fleet-core/admiral/store`: Fleet model/runtime store helpers.
- `@sbluemin/fleet-core/admiralty`: Grand Fleet domain prompt builders, reporter helpers, status-source logic, text sanitization, tool specs, and shared types.
- `@sbluemin/fleet-core/admiralty/ipc`: Grand Fleet JSON-RPC protocol contracts and message helpers.
- `@sbluemin/fleet-core/admiral/protocols`: protocol catalogs and active-protocol prompt builders for Admiral orchestration.
- `@sbluemin/fleet-core/admiral/protocols/standing-orders`: always-on standing-order prompt builders and related doctrine helpers.
- `@sbluemin/fleet-core/services/tool-registry`: Tool Registry manifest registration and lookup helpers.
- `@sbluemin/fleet-core/metaphor/operation-name`: operation-name prompt builders, schemas, and runtime helpers.
- `@sbluemin/fleet-core/metaphor/directive-refinement`: directive-refinement prompt builders, schemas, and runtime helpers.
- `@sbluemin/fleet-core/services`: shared pure service barrels for Pi adapter consumption. Includes agent, job, settings, keybind, log, and tool-registry.
- `@sbluemin/fleet-core/services/settings`: runtime-owned settings registry/store contracts and helpers. Setter-style provider APIs (settings-port) have been removed in favor of runtime-owned singletons.
- `@sbluemin/fleet-core/services/keybind`: keybind registry/store contracts and helpers.
- `@sbluemin/fleet-core/services/log`: log store contracts and file-backed helpers.
