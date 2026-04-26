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
| `runtime.ts` | Shared | Runtime initialization, `.data/` ownership, session store lifecycle. Uses the Fleet data directory (`~/.pi/fleet`) so carrier and host/provider paths share one session-map store. |
| `pool.ts` | Shared | Carrier execution Unified Agent client pooling and disconnect helpers. |
| `executor.ts` | Shared | Carrier execution engine and one-shot command routing. |
| `provider-types.ts` | Provider | host/provider 경로 전용 전역 CLI 시스템 프롬프트의 단일 소스(`setCliSystemPrompt`/`getCliSystemPrompt`). `executor.buildConnectOptions`가 이 전역 상태를 조회하여 `unified-agent`에 전달합니다. |
| `provider-register.ts` | Provider | Core 엔트리 포인트. ACP 프로바이더와 세션 라이프사이클 훅을 등록하고, provider-only reload/resume에서도 `initRuntime(~/.pi/fleet)` + `onHostSessionChange(piSessionId)`를 보장합니다. `session_start`와 `session_tree` 모두 PI 세션 바인딩을 수행합니다. |
| `thinking-level-patch.ts` | Provider | PI의 hardcoded thinking level 계산을 Fleet ACP 모델에 한해 보정하는 런타임 patch. models.json의 reasoningEffort.levels를 source of truth로 사용하여 `minimal` 제거, `xhigh` 노출, invalid level 보정을 담당합니다. |
| `provider-stream.ts` | Provider | `streamSimple` 구현, 세션 재사용, 모델 전환, Persistence 연계. **이전의 `<system-instructions>` 직접 XML 주입 로직이 제거되었으며, host/provider 경로는 `unified-agent`의 `connect` 옵션을 통해 시스템 프롬프트를 처리합니다. Carrier 도구 실행 경로는 이를 상속하지 않습니다.** |
| `provider-events.ts` | Provider | ACP event to pi `EventStream` mapper, including MCP tool-call and CLI built-in tool rendering. |
| `provider-mcp.ts` | Provider | In-process MCP HTTP JSON-RPC server with FIFO tool-call queue and session token isolation. |
| `provider-tools.ts` | Provider | Tool registry plus schema adaptation from pi tools to MCP input schemas. |
| `service-status/` | Shared | Service health polling, snapshot storage, injected callback notifications, optional rendering helpers. |

## ACP 모델 ID 등록 / Thinking Level 우회 정책

- Fleet ACP는 PI `Model.id`를 **models.json의 display `name` + ` (ACP)` postfix** 로 등록한다.
- `provider-types.parseModelId()`는 **postfix가 붙은 등록명 / plain display name / backend `modelId`** 를 모두 역파싱해 세션/내부 상태 호환을 유지한다.
- PI SDK의 `registerProvider()`는 per-model thinking level 목록을 받지 못하므로, Fleet ACP는 `thinking-level-patch.ts`에서 `AgentSession.prototype.getAvailableThinkingLevels()`를 런타임 patch 한다.
- 따라서 `xhigh` 노출 여부는 더 이상 PI 내부 `supportsXhigh(model.id)` 휴리스틱에 의존하지 않고, Fleet ACP patch가 `models.json`을 직접 읽어 결정한다.
- Fleet ACP 모델의 available thinking levels는 `packages/unified-agent/models.json`의 `reasoningEffort.levels`를 source of truth로 사용하며, UI에는 `none`을 노출하지 않고 `off` + 나머지 유효 레벨(`low`/`medium`/`high`/`xhigh`)만 노출한다.
- 세션 시작 및 모델 전환 시 현재 thinking level이 새 모델의 available levels에 없으면 가장 가까운 유효 레벨로 자동 보정한다. 예: Codex에서 `minimal` → `low`.

## reasoning_effort / budget_tokens 세션 설정

`effort`와 `budget_tokens`는 `connect` 시점의 고정값이 아닌, `setConfigOption()`을 통해 세션 범위에서 동적으로 갱신되는 세션 설정(session config)입니다.

### Sticky 규칙 (유지 정책)

1.  **호출자 명시**: 호출자가 명시적으로 값을 전달하면 `setConfigOption()`으로 세션을 갱신하고, 해당 값을 `launch metadata`에 저장합니다.
2.  **미지정**: 호출자가 값을 지정하지 않으면 풀 키(`carrierId`) 단위로 기존 세션에 설정된 값이 그대로 유지됩니다. (불필요한 `setConfigOption` 호출이 발생하지 않음)
3.  **Fresh Reconnect**: 세션/풀의 재연결이나 재생성(예: `systemPrompt drift`, `session/load` 실패 시) 시에도, 호출자가 명시한 값이 없으면 `launch metadata`에 보존된 이전 설정을 자동 폴백(fallback)으로 재적용합니다.
4.  **초기화**: 설정을 변경하거나 리셋하려면 호출자가 명시적으로 새로운 레벨이나 값을 전달해야 합니다.

### Capability Pre-guard

ACP 레이어는 설정을 적용하기 전 `unified-agent`의 `getReasoningEffortLevels(cli)`를 통해 해당 CLI의 지원 여부를 사전 조회합니다. 지원하지 않는 CLI에서는 `setConfigOption` 호출을 조용히 스킵(silent skip)하며, 이는 에러가 아닌 정상적인 동작으로 간주됩니다. (로그에는 경고가 남을 수 있음)

### SystemPrompt 정책과의 차이

`systemPrompt`는 `connect` 시점에 `getCliSystemPrompt()`가 반환하는 전역 단일 소스에 의해 고정(fixed)되지만, `effort`는 런타임 가변 설정입니다. 따라서 이 둘은 동일한 패턴으로 관리되지 않으며, `effort`는 명시적 변경이 있을 때만 갱신되는 가변 속성으로 취급됩니다.

### Host/Provider 경로 (PI Shift+Tab)

PI 사용자가 Shift+Tab으로 선택한 thinking level은 `SimpleStreamOptions.reasoning` / `SimpleStreamOptions.thinkingBudgets`로 `streamAcp()`에 전달됩니다. `provider-stream.ts`의 `resolveEffortFromOptions()`가 PI의 `ThinkingLevel`을 ACP `effort`/`budgetTokens`로 변환합니다.

**ThinkingLevel → effort 매핑:**
- PI `"minimal"` → ACP `"none"` (Codex의 최소 레벨)
- `"low"` / `"medium"` / `"high"` / `"xhigh"` → 동일 문자열 (1:1)

**ThinkingBudgets → budgetTokens 매핑:**
- PI `ThinkingBudgets`에 `"xhigh"` 키가 없으므로 `"high"` 버킷으로 폴백
- `budgetTokens`는 Claude 전용 (`applyPostConnectConfig`에서 `cli === "claude"`일 때만 적용)

전달 체인: `streamAcp` → `resolveEffortFromOptions()` → `ensureSession(effortOverrides)` → `UnifiedAgent.connect()` → `applyPostConnectConfig()` → `setConfigOption()` RPC.

### Carrier 개발자 가이드

"매 sortie(실행)마다 `effort`를 명시할 필요가 없습니다. 이전 설정이 세션에 유지(sticky)되므로, 변경이 필요한 시점에만 명시적으로 값을 전달하십시오."

## Session Lifecycle

| Trigger | Behavior |
|---------|----------|
| **First request** | host/provider 경로에서는 CLI 프로세스를 생성하고, `connect` 시 전역 단일 소스(`getCliSystemPrompt`)의 `systemPrompt`를 `unified-agent`에 전달합니다 (Claude: native append, Codex/Gemini: 첫 sendMessage prefix). Carrier 도구 실행 경로는 이를 상속하지 않으며, MCP 서버 URL과 세션별 인증 토큰 주입만 수행합니다. |
| **Model change within same CLI family** | Reuse the current process and switch backend model without recreating the whole session when the backend supports it. |
| **Model change across CLI families** | Dispose the old session/process pair and create a fresh CLI session. |
| **pi `/new`** | Clear live sessions and processes, then lazily recreate on the next request. |
| **pi shutdown / restart** | `.data/session-maps/<piSessionId>.json` is restored for the active PI session. Carrier and host/provider paths replay the stored real CLI/ACP `sessionId` via `connect({ sessionId })`; validated dead-session/not-found failures fall back to a fresh session and rewrite the mapping. |

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

- `.data/session-maps/<piSessionId>.json` is the durable source of truth for PI-session-keyed resume mappings.
- `provider-register.ts` initializes the same runtime directory as Fleet (`~/.pi/fleet`) and binds the active PI session on `session_start` / `session_tree` before provider streaming can read the store.
- `provider-stream.ts` defensively re-binds the store from `SimpleStreamOptions` session identifiers before reading/writing `host:<cli>` so slash resume ordering cannot fall back to the noop store or a stale map file.
- The JSON schema remains `Record<string, string>`: carrier path keys use `carrierId`; host/provider path keys use `host:<cli>` (for example `host:codex`).
- MCP bearer tokens, tool registries, routers, FIFO queues, and live client objects are process-local artifacts. They are recreated for every resumed provider process and are never persisted.
- Enhanced cleanup is enforced for `toolUse`, `abort`, and `promptComplete` events to prevent leaked live routing state across turns.

## Service Status Monitoring

The shared service-status subsystem follows a polling plus callback pattern:

1. Poll provider health endpoints or status commands on an interval.
2. Attach the latest snapshot to shared runtime context for downstream consumers.
3. Invoke registered callbacks only when status changes so UI refreshes stay decoupled from core monitoring code.
