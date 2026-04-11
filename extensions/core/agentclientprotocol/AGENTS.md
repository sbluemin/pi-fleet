# core/agentclientprotocol

Unified ACP infrastructure for pi-fleet, providing both the carrier execution engine and the pi provider integration in one flat module boundary.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  pi agent-loop (host)                                       │
│                                                              │
│  streamSimple(model, context, options)                       │
│      │                                                       │
│      ▼                                                       │
│  ┌──────────────────┐    ┌──────────────────┐                │
│  │ provider-stream.ts│───▶│ provider-events.ts│──▶ EventStream│
│  └─────────┬────────┘    └──────────────────┘                │
│            │                                                 │
│            │ ACP stdio                                       │
│            ▼                                                 │
│  ┌─────────────────┐        ┌──────────────────┐             │
│  │ AcpConnection   │        │ provider-mcp.ts  │             │
│  │ (unified-agent) │        │ (HTTP JSON-RPC)  │             │
│  └────────┬────────┘        └────────▲─────────┘             │
│           │                          │                       │
│           ▼                          │ MCP tools/call        │
│     ┌───────────┐                    │                       │
│     │ CLI Process│────────────────────┘                      │
│     │ (claude,   │                                           │
│     │  codex,    │                                           │
│     │  gemini)   │                                           │
│     └───────────┘                                            │
└──────────────────────────────────────────────────────────────┘
```

## Core Rules

- **Zero-Dependency on Fleet**: `extensions/fleet/` or `extensions/carriers/` imports are forbidden.
- **One-Way Dependency**: Only fleet or carriers may depend on `core/agentclientprotocol`.
- **Provider-Agnostic Shared Infra**: `pool.ts`, `executor.ts`, `runtime.ts`, `session-store.ts`, and `service-status/` stay generic across CLI providers.
- **Provider Stream Boundary**: `provider-stream.ts` MUST NOT import `AcpConnection` directly. ACP process/session primitives stay behind shared runtime and executor boundaries.
- **Service Status Injection**: `service-status/` notifies UI consumers through callback injection so core infrastructure never pulls fleet UI code inward.

## Module Structure

| File | Domain | Role |
|------|--------|------|
| `types.ts` | Shared | Common ACP and execution types shared across flat agent/provider boundaries. |
| `session-store.ts` | Shared | SessionMapStore for PI session to carrier session persistence. |
| `runtime.ts` | Shared | Runtime initialization, `.data/` ownership, session store lifecycle. |
| `pool.ts` | Shared | `UnifiedAgentClient` connection pooling and disconnect helpers. |
| `executor.ts` | Shared | Execution engine for pooled session acquisition and command routing. |
| `provider-types.ts` | Provider | Provider constants, ACP session state, model catalog, provider IDs. |
| `provider-register.ts` | Provider | Core entry point that registers the ACP provider and session lifecycle hooks. |
| `provider-stream.ts` | Provider | `streamSimple` implementation, session reuse, model switching, abort handling, persistence handoff. |
| `provider-events.ts` | Provider | ACP event to pi `EventStream` mapper, including MCP tool-call and CLI built-in tool rendering. |
| `provider-mcp.ts` | Provider | In-process MCP HTTP JSON-RPC server with FIFO tool-call queue and session token isolation. |
| `provider-tools.ts` | Provider | Tool registry plus schema adaptation from pi tools to MCP input schemas. |
| `service-status/` | Shared | Service health polling, snapshot storage, injected callback notifications, optional rendering helpers. |

## Session Lifecycle

| Trigger | Behavior |
|---------|----------|
| **First request** | Spawn CLI process, establish ACP session, inject MCP server URL and per-session auth token. |
| **Model change within same CLI family** | Reuse the current process and switch backend model without recreating the whole session when the backend supports it. |
| **Model change across CLI families** | Dispose the old session/process pair and create a fresh CLI session. |
| **pi `/new`** | Clear live sessions and processes, reset pre-spawn state, then lazily recreate on the next request. |
| **pi shutdown** | Persist PI session to carrier session mappings under `.data/session-maps/` using ACP namespaced keys. |
| **pi restart / resume** | Restore persisted mappings through `SessionMapStore` and attempt provider-specific session reload when supported. |

### Provider and Event Mapper Contract

- `provider-stream.ts` creates the mapper from `provider-events.ts` and owns listener registration and cleanup.
- The mapper filters by target ACP session ID so unrelated session events never leak into the active PI turn.
- Two entry paths must remain intact:
  - **Case 1 (Fresh Query)**: latest user message is sent to the CLI and normal streaming begins.
  - **Case 2 (Tool Result Delivery)**: pi tool output resolves the next queued MCP tool call, then streaming resumes on the same CLI turn.

## MCP Tool Execution Flow

```
1. CLI sends an MCP `tools/call` HTTP request.
2. provider-mcp.ts queues the request in FIFO order and keeps the HTTP response open.
3. provider-stream.ts is notified through the tool-arrived callback.
4. provider-events.ts emits a toolCall content block and ends the current stream turn with `done="toolUse"`.
5. pi agent-loop executes the requested tool through ToolExecutionComponent.
6. pi re-enters `streamSimple` with the tool result payload.
7. provider-stream.ts resolves the next queued MCP call result.
8. provider-mcp.ts returns the HTTP response and the CLI continues streaming.
```

## Dual Tool Routing

CLI-visible tools are split into two paths:

| Category | MCP Tool | CLI Built-in Tool |
|----------|----------|-------------------|
| **Path** | MCP HTTP -> pi agent-loop -> ToolExecutionComponent | Executed internally by the CLI |
| **Rendering** | Native pi tool rendering with expand/collapse support | Inline completion line inside assistant output |
| **Turn control** | `done="toolUse"` pauses stream for pi execution | Stream keeps running until normal completion |
| **Examples** | `bash`, `read`, `edit`, `write` exposed from pi | CLI-native search/read helpers |

Provider events must preserve this distinction so pi-native tools remain inspectable while CLI-native tools stay lightweight.

## Persistence

`runtime.ts` owns the `.data/` base directory for this module.

- Session maps are persisted under `.data/session-maps/`.
- Stored data is limited to PI session to carrier session continuity and ACP namespaced session metadata.
- Fleet-wide user configuration such as model selection remains outside this module.

## Service Status Monitoring

The shared service-status subsystem follows a polling plus callback pattern:

1. Poll provider health endpoints or status commands on an interval.
2. Attach the latest snapshot to shared runtime context for downstream consumers.
3. Invoke registered callbacks only when status changes so UI refreshes stay decoupled from core monitoring code.
