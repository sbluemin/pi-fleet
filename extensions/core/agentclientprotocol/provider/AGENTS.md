# ACP Provider (core/agentclientprotocol/provider)

ACP(Agent Communication Protocol) 기반 CLI 백엔드(Claude, Codex, Gemini)를 pi-coding-agent의 agent loop과 TUI에 네이티브 통합하는 프로바이더 확장.

Provider ID: `"Fleet ACP"`

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  pi agent-loop (host)                                    │
│                                                          │
│  streamSimple(model, context, options)                   │
│      │                                                   │
│      ▼                                                   │
│  ┌────────────┐     ┌────────────────┐                   │
│  │ provider.ts │────▶│ event-mapper.ts│──▶ EventStream    │
│  └─────┬──────┘     └────────────────┘                   │
│        │                                                 │
│        │  ACP stdio                                      │
│        ▼                                                 │
│  ┌─────────────────┐        ┌──────────────────┐         │
│  │ AcpConnection   │        │ mcp-server.ts    │         │
│  │ (unified-agent)  │        │ (HTTP JSON-RPC)  │         │
│  └────────┬────────┘        └────────▲─────────┘         │
│           │                          │                   │
│           ▼                          │ MCP tools/call    │
│     ┌───────────┐                    │                   │
│     │ CLI Process│────────────────────┘                   │
│     │ (claude,   │                                       │
│     │  codex,    │                                       │
│     │  gemini)   │                                       │
│     └───────────┘                                        │
└──────────────────────────────────────────────────────────┘
```

## Core Concepts

### Dual Tool Routing

CLI 프로세스가 사용하는 도구는 두 종류로 나뉜다:

| 구분 | MCP Tool | CLI Built-in Tool |
|------|----------|-------------------|
| **경로** | MCP HTTP → pi agent-loop → ToolExecutionComponent | CLI 내부 자체 실행 |
| **렌더링** | pi 네이티브 (Ctrl+O 확장/축소 지원) | 한 줄 인라인 표시 (`` `title` ✔ ``) |
| **done 시그널** | `"toolUse"` → pi가 실행 후 재진입 | — (스트리밍 계속) |
| **예시** | `bash`, `read`, `edit`, `write` 등 pi 도구 | CLI 자체 검색, 파일 읽기 등 |

### MCP Tool Execution Flow (FIFO Queue)

```
1. CLI가 MCP tools/call HTTP 요청 전송
2. mcp-server가 FIFO 큐에 요청 적재 (HTTP 응답 보류)
3. provider가 toolCallArrivedCallback으로 통지받음
4. event-mapper가 toolCall content block 생성 + done="toolUse" 반환
5. pi agent-loop이 ToolExecutionComponent로 도구 실행
6. pi가 결과와 함께 streamSimple 재호출 (Case 2)
7. provider가 resolveNextToolCall()로 FIFO 큐 해소
8. mcp-server가 HTTP 응답 반환 → CLI 계속 진행
```

### Session Lifecycle

| 트리거 | 동작 |
|--------|------|
| **최초 요청** | CLI 프로세스 spawn → ACP 세션 생성 → MCP 서버 URL 주입 |
| **동일 CLI 모델 변경** | `connection.setModel()` 호출 (프로세스 유지) |
| **다른 CLI 모델 변경** | 기존 세션 종료 → 새 CLI 프로세스 spawn |
| **pi `/new`** | 전체 세션/프로세스 정리 → preSpawn 풀 초기화 → 재생성 |
| **pi 종료** | 세션 상태를 `~/.pi/fleet/session-maps/{piSessionId}.json`에 네임스페이스 키(`acp:{cli}:{field}`)로 영속화 |
| **pi 재시작** | SessionMapStore에서 영속화된 세션 복원 시도 (Claude: `session/load`, Codex: `session/load`, Gemini: fallback) |

### Provider ↔ EventMapper Contract

- `provider.ts`가 `createEventMapper()`를 호출하여 ACP 이벤트를 pi `EventStream`으로 변환
- EventMapper는 **세션 ID 필터링** — `setTargetSessionId()`로 설정된 세션만 처리
- **두 가지 진입 경로**:
  - **Case 1 (Fresh Query)**: 사용자 메시지 → `sendPrompt()` fire-and-forget → 스트리밍
  - **Case 2 (Tool Result Delivery)**: MCP 도구 결과 → `resolveNextToolCall()` → 리스너 재연결 → 스트리밍 계속

## Layer Separation

| 레이어 | 책임 | 금지 사항 |
|--------|------|-----------|
| **unified-agent** (패키지) | ACP 프로토콜, CLI 프로세스 관리, 세션 추상화 | MCP, HTTP, 도구 레지스트리 관련 코드 금지 |
| **acp-provider** (확장) | MCP 서버, HTTP 인증, 도구 레지스트리, 스키마 변환, 이벤트 매핑 | `extensions/fleet/`, `extensions/carriers/` import 금지 |

unified-agent에는 `mcpServers` 파라미터 주입 seam만 존재하며, MCP 구현 자체는 acp-provider가 전적으로 소유한다.

## MCP Server

- **프로토콜**: Raw JSON-RPC 2.0 over HTTP (MCP SDK 미사용)
- **바인딩**: `127.0.0.1:0` (OS 동적 포트, loopback only)
- **인증**: opaque URL path + per-session Bearer 토큰
- **인터페이스**: `initialize`, `tools/list`, `tools/call`
- **실행 방식**: 직접 실행하지 않음 — FIFO 큐 + pi agent-loop 위임
- **도구 등록**: `tool-registry.ts`가 pi의 `context.tools`에서 per-session 스냅샷 생성
- **스키마 변환**: `schema-adapter.ts`가 TypeBox → JSON Schema 변환

## CLI-Specific Behaviors

### Tool Name Patterns (MCP)

각 CLI는 MCP 도구명을 다르게 인코딩한다:

| CLI | 패턴 | 예시 |
|-----|------|------|
| Codex | `Tool: {server}/{name}` | `Tool: pi-tools/read` |
| Claude | `mcp__{server}__{name}` | `mcp__pi-tools__read` |
| Gemini | `{name} ({server} MCP Server)` | `read (pi-tools MCP Server)` |

### CLI Built-in Tool Rendering

CLI 자체 도구 호출은 한 줄 인라인으로 표시된다:

- **완료 시점에만 렌더링** (진행 중 표시 없음)
- **Claude 특이사항**: `onToolCall`(start)에서 generic title만 제공 (`"Read File"`, `"grep"`). 중간 update에서 상세 title이 올 수 있으나, 직접 `completed`로 오는 경우도 있음. `lastCliToolStart` fallback + 중간 update title 갱신으로 대응.
- **Codex**: `rawInput`에 `call_id` 포함 → `activeCliTools` Map으로 정확한 추적 가능.

## Module Responsibilities

| 모듈 | 역할 |
|------|------|
| `register.ts` | core 루트 wiring에서 호출되는 모듈 진입점 — 프로바이더 등록, 세션 lifecycle 핸들러 |
| `provider.ts` | streamSimple 구현 — 세션 관리, Case 1/Case 2 분기, abort 처리, 영속화 |
| `event-mapper.ts` | ACP 이벤트 → pi EventStream 변환 — 텍스트/thinking 블록, MCP tool call, CLI tool 렌더링 |
| `mcp-server.ts` | HTTP MCP 서버 singleton — JSON-RPC 핸들러, FIFO 큐, 토큰 인증 |
| `tool-registry.ts` | pi `context.tools` → MCP 도구 등록 — per-session 스냅샷, pi 기본 도구 필터링 |
| `schema-adapter.ts` | TypeBox JSON Schema → MCP `inputSchema` 변환 |
| `types.ts` | 공유 타입, 상수, 모델 카탈로그, 상태 관리 |

## Constraints

- `sendMessage()`는 스트리밍 중/후에 사용 불가 (`steer()` 호출됨)
- `agent_end` 이벤트는 ACP 프로바이더 확장에서 발생하지 않음
- pi EventStream은 `push(event)` + `end(result?)` + `[Symbol.asyncIterator]` — EventEmitter 아님
- `autoApprove: true` + `yoloMode: true`로 CLI 프로세스 생성 (권한 요청 자동 승인)
