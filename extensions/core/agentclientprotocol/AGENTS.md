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

- **Zero-Dependency on Fleet**: `extensions/fleet/` imports, including `extensions/fleet/carriers/`, are forbidden.
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
| `provider-types.ts` | Provider | host/provider 경로 전용 전역 CLI 시스템 프롬프트의 단일 소스(`setCliSystemPrompt`/`getCliSystemPrompt`). `executor.buildConnectOptions`가 host policy에서만 이를 소비하여 `unified-agent`에 전달합니다. |
| `provider-register.ts` | Provider | Core 엔트리 포인트. ACP 프로바이더와 세션 라이프사이클 훅을 등록합니다. |
| `provider-stream.ts` | Provider | `streamSimple` 구현, 세션 재사용, 모델 전환, Persistence 연계. **이전의 `<system-instructions>` 직접 XML 주입 로직이 제거되었으며, host/provider 경로는 `unified-agent`의 `connect` 옵션을 통해 시스템 프롬프트를 처리합니다. Carrier 도구 실행 경로는 이를 상속하지 않습니다.** |
| `provider-events.ts` | Provider | ACP event to pi `EventStream` mapper, including MCP tool-call and CLI built-in tool rendering. |
| `provider-mcp.ts` | Provider | In-process MCP HTTP JSON-RPC server with FIFO tool-call queue and session token isolation. |
| `provider-tools.ts` | Provider | Tool registry plus schema adaptation from pi tools to MCP input schemas. |
| `service-status/` | Shared | Service health polling, snapshot storage, injected callback notifications, optional rendering helpers. |

## Session Lifecycle

| Trigger | Behavior |
|---------|----------|
| **First request** | host/provider 경로에서는 CLI 프로세스를 생성하고, `connect` 시 `systemPrompt`를 `unified-agent`에 전달합니다 (Claude: native append, Codex/Gemini: 첫 sendMessage prefix). Carrier 도구 실행 경로는 Admiral systemPrompt를 상속하지 않으며, MCP 서버 URL과 세션별 인증 토큰 주입만 수행합니다. |
| **Model change within same CLI family** | Reuse the current process and switch backend model without recreating the whole session when the backend supports it. |
| **Model change across CLI families** | Dispose the old session/process pair and create a fresh CLI session. |
| **pi `/new`** | Clear live sessions and processes, reset pre-spawn state, then lazily recreate on the next request. |
| **pi shutdown / restart** | Sessions are ephemeral and tied to the live process lifecycle. Persistence of session mappings for resume is no longer supported; fresh sessions are created on restart. |

### Provider and Event Mapper Contract

- `provider-stream.ts` creates the mapper from `provider-events.ts` and owns listener registration and cleanup.
- The mapper filters by target ACP session ID so unrelated session events never leak into the active PI turn.
- **Strict Session Identification**: Provider scope is tied exclusively to `sessionId` identifiers. `cwd` fallback or `activeSessionKey` standalone dependency is forbidden to prevent cross-session routing collisions.
- Two entry paths must remain intact:
  - **Case 1 (Fresh Query)**: latest user message is sent to the CLI and normal streaming begins.
  - **Case 2 (Tool Result Delivery)**: pi tool output resolves the next queued MCP tool call using strict `toolCallId` verification, then streaming resumes on the same CLI turn.

## MCP Tool Execution Flow

```
1. CLI sends an MCP `tools/call` HTTP request with a unique `toolCallId`.
2. provider-mcp.ts verifies the session token and retrieves the live router callback for that session.
3. provider-mcp.ts queues the request in per-session FIFO order (`pendingToolCalls`) and keeps the HTTP response open.
4. The router (callback) stays alive across `done="toolUse"` handoffs within the same logical prompt to handle subsequent tool calls.
5. provider-stream.ts is notified through the tool-arrived callback and registers the call in the session's pending list.
6. provider-events.ts emits a toolCall content block and ends the current stream turn with `done="toolUse"`.
7. pi agent-loop executes the requested tool through ToolExecutionComponent.
8. pi re-enters `streamSimple` with the tool result and the original `toolCallId`.
9. provider-stream.ts validates that the result `toolCallId` matches the head of the per-session FIFO queue.
10. provider-mcp.ts resolves the queued MCP call and returns the HTTP response.
```

### Router Lifetime and Cleanup

- **Router Attachment**: A router (callback) is attached to the singleton MCP server using the session's bearer token when a prompt starts or resumes during tool result delivery.
- **Persistence**: The router remains active as long as the logical prompt is "in-flight," even when the `streamSimple` turn ends with `done="toolUse"`.
- **Terminal Cleanup**: The router is **explicitly detached** (`detachToolCallRouter`) and all pending calls are cleared when a terminal state is reached:
  - `done="stop"` (Normal completion)
  - `error` (Execution failure)
  - `aborted` (User-initiated abort)
- **Safety**: Once detached, any late or stale MCP `tools/call` requests from the CLI will fail immediately with a "router cleaned up" error (-32000) instead of hanging or causing cross-prompt side effects.

## MCP Server Architecture

The ACP bridge uses an in-process, singleton HTTP MCP server for efficiency and isolation:

- **Loopback Binding**: Listens on `127.0.0.1` with a random ephemeral port.
- **Opaque Path**: Uses a UUID-based path (e.g., `http://127.0.0.1:PORT/<opaque-path>`) to prevent unauthorized discovery.
- **Bearer Token Isolation**: Each ACP session is assigned a unique UUID token. The server uses this token to:
  - Route tool calls to the correct session's FIFO queue.
  - Access the correct tool definitions for that specific session.
  - Authenticate the CLI process.
- **FIFO Guarantee**: Enforces strict execution order. If a tool result arrives before the corresponding MCP call (due to race conditions), it is pre-queued and resolved immediately when the call arrives.

## Dual Tool Routing

CLI-visible tools are split into two paths:

| Category | MCP Tool | CLI Built-in Tool |
|----------|----------|-------------------|
| **Path** | MCP HTTP -> pi agent-loop -> ToolExecutionComponent | Executed internally by the CLI |
| **Routing Evidence** | `toolCallId` (Primary) + session token FIFO order + live router ownership | Implicit (intra-process) |
| **Rendering** | Native pi tool rendering with expand/collapse support | Inline completion line inside assistant output |
| **Turn control** | `done="toolUse"` pauses stream for pi execution | Stream keeps running until normal completion |

## Persistence

`runtime.ts` owns the `.data/` base directory for this module.

- Persistence of session-to-carrier mappings is limited to runtime continuity; long-term session resume across restarts is deprecated.
- Stored data focus shifted to ephemeral session metadata and service snapshots.
- Enhanced cleanup is enforced for `toolUse`, `abort`, and `promptComplete` events to prevent leaked state across turns.

## Service Status Monitoring

The shared service-status subsystem follows a polling plus callback pattern:

1. Poll provider health endpoints or status commands on an interval.
2. Attach the latest snapshot to shared runtime context for downstream consumers.
3. Invoke registered callbacks only when status changes so UI refreshes stay decoupled from core monitoring code.
