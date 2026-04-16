# admiral

Admiral **prompt policy** extension — Standing Orders, Protocols, worldview toggle, settings section ownership, and **ACP CLI system prompt composition**.

This extension is the **top-level orchestrator** with a has-a relationship to `fleet/` and `carriers/`. It may import from `fleet/shipyard/` (carrier framework, store, tool prompts) and `core/agentclientprotocol/provider-types` (CLI system prompt setter). It also depends on `core/settings` and `core/keybind` (infrastructure layer).

## 핵심 개념

### Standing Orders

모든 프로토콜에 **항상 주입**되는 cross-cutting 메커니즘. 프로토콜과 무관하게 에이전트 행동을 규율한다.

### Protocols

**상호 배타적**으로 전환되는 워크플로우. 한 번에 하나의 프로토콜만 활성화되며, `Alt+N`으로 전환한다.

### ACP Runtime Protocol Switching

ACP 모드에서는 시스템 프롬프트가 최초 1회만 전달되므로, 초기 프롬프트에 **전체 프로토콜 카탈로그**를 포함하고, 매 턴 `<current_protocol>` 태그로 활성 프로토콜을 지정한다. `setCliRuntimeContext()` / `getCliRuntimeContext()` globalThis getter 쌍을 통해 admiral과 provider-stream 간 결합 없이 상태를 전달한다.

## Responsibilities

| Responsibility | Implementation |
|----------------|----------------|
| System prompt injection (`before_agent_start`) | `index.ts` — Standing Orders + 활성 Protocol 프롬프트 주입 (pi 자체 프롬프트) + ACP 런타임 컨텍스트 갱신 |
| ACP CLI system prompt composition (`session_start`) | `index.ts` — ACP 프로바이더 감지 시 `buildAcpSystemPrompt()` → `setCliSystemPrompt()` (프로토콜 카탈로그 포함) |
| ACP runtime context (`before_agent_start`, protocol switch) | `index.ts` — `buildAcpRuntimeContext()` → `setCliRuntimeContext()` (매 턴 `<current_protocol>` 태그 갱신) |
| Worldview toggle command | `index.ts` — `fleet:admiral:worldview` command |
| Protocol 전환 | `index.ts` — `Alt+N` 키바인드, `fleet:admiral:protocol` 커맨드 (향후 추가 가능) |
| Settings section ("Admiral") | `index.ts` — registers in Alt+/ popup, owns `admiral` settings key |
| 활성 프로토콜 상태 표시 | `widget.ts` — aboveEditor 위젯 |
| Prompt constants & settings logic | `prompts.ts` — worldview/system append + `PROTOCOL_PREAMBLE` + `RUNTIME_PROTOCOL_SWITCHING_PROMPT` + settings 함수 + `buildAcpRuntimeContext()` |
| 에디터 테두리 색상 | globalThis `"__pi_hud_editor_border_color__"` 키로 `core/hud`에 간접 통신 |

## Settings

| Key | Type | Description |
|-----|------|-------------|
| `admiral.worldview` | `boolean` | Worldview 프롬프트 주입 여부 |
| `admiral.activeProtocol` | `string` | 현재 활성 프로토콜 ID (기본: `fleet-action`) |

## Keybindings

| Key | Command | Description |
|-----|---------|-------------|
| `Alt+1` | `fleet:admiral:protocol` | Fleet Action Protocol로 전환 |
| `Alt+2~9` | `fleet:admiral:protocol` | 동적으로 할당된 프로토콜로 전환 |
| `Alt+/` | `fleet:settings:open` | Admiral 설정을 포함한 설정 팝업 열기 |

## Module Structure

| File | Role |
|------|------|
| `index.ts` | admiral 내부 부트 모듈 — 프로토콜/설정/커맨드/ACP 프롬프트 wiring 소유, `fleet/index.ts`가 호출 |
| `prompts.ts` | Worldview/REQUEST_DIRECTIVE 프롬프트 상수 + `PROTOCOL_PREAMBLE` + settings 함수 + `buildAcpSystemPrompt()` (ACP CLI 지침 합성) |
| `request-directive.ts` | `request_directive` tool — Fleet Admiral에게 전략적 지시를 요청하는 TUI 도구 |
| `widget.ts` | aboveEditor 위젯 — 활성 프로토콜 상태 표시 |
| `standing-orders/types.ts` | `StandingOrder` 인터페이스 |
| `standing-orders/index.ts` | Standing Order 레지스트리 |
| `standing-orders/delegation-policy.ts` | Delegation Policy Standing Order |
| `standing-orders/deep-dive.ts` | Deep Dive Standing Order |
| `protocols/types.ts` | `AdmiralProtocol` 인터페이스 |
| `protocols/index.ts` | Protocol 레지스트리 + 활성 프로토콜 관리 |
| `protocols/fleet-action.ts` | Fleet Action Protocol |

## Tools

| Tool | Description |
|------|-------------|
| `request_directive` | Fleet Admiral(사용자)에게 전략적 지시를 요청. 1-4개 질문, 각 2-4개 선택지 + 직접 입력. multiSelect, 탭 네비게이션 지원. preview는 단일 선택에서만 허용되며 질문/선택지 중복은 거부된다. |

## Core Rules

- **Top-level orchestrator** — admiral has-a relationship to `fleet/` and `carriers/`.
- **Dependency direction**: `admiral/` 라이브러리 모듈 → `core/settings`, `core/keybind`, `core/agentclientprotocol/provider-types` (setter API only), `fleet/shipyard/` (carrier framework, store, tool prompts). 실제 admiral wiring은 `admiral/index.ts`가 소유하고, `fleet/index.ts`는 이를 호출하는 상위 facade다.
- **에디터 테두리 간접 통신**: globalThis `"__pi_hud_editor_border_color__"` 키를 통해 `core/hud/border-bridge.ts`와 간접 통신.
- **Command naming**: follows `fleet:<domain>:<feature>` form — `fleet:admiral:worldview`, `fleet:admiral:protocol`.
- **Prompt text lives in `prompts.ts`** — worldview/system append와 `PROTOCOL_PREAMBLE`, `request_directive` 가이드 모두 `prompts.ts`에 둔다.
- **Settings key is `admiral`** — not `fleet`.
- **Standing Orders는 항상 주입** — 프로토콜 활성 여부와 무관하게 모든 에이전트 세션에 포함.
- **Protocols는 상호 배타적** — 동시에 하나만 활성화. 항상 하나의 프로토콜이 활성 상태.
