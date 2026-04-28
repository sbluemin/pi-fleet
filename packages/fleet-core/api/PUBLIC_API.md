# Fleet Core Public API

This contract is the external surface for `@sbluemin/fleet-core`. It is frozen for the productization migration and is implemented through the root barrel plus documented subpath exports.

## Runtime

- `createFleetCoreRuntime(options: FleetCoreRuntimeOptions): FleetCoreRuntime`
- `FleetCoreRuntimeOptions = { dataDir: string; ports: FleetHostPorts; backend: BackendAdapter; }`
- `FleetCoreRuntime = { agent; jobs; carriers; admiral; metaphor; experimentalWiki?; grandFleet?; toolRegistry; mcp; shutdown(): Promise<void>; }`

## Agent Runtime

- `createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime`
- `AgentRuntimeOptions = { dataDir: string; ports: FleetHostPorts; backend: BackendAdapter; toolRegistry?: AgentToolRegistry; }`
- `AgentRuntime = { toolRegistry: AgentToolRegistry; mcp: McpRegistryAPI; shutdown(): Promise<void>; }`

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
- `LlmClient`
- `LlmCompleteRequest`
- `LlmCompleteResult`

`LlmClient` is an injected port. fleet-core never imports `@mariozechner/pi-ai`.

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
