# admiral

Admiral **prompt policy** extension — Standing Orders, Protocols, worldview toggle, settings section ownership, and **system prompt composition for ACP CLI**.

This extension is the **top-level orchestrator** with a has-a relationship to `fleet/` and `carriers/`. It may import from `fleet/shipyard/` (carrier framework, store, tool prompts) and `metaphor/` (persona/tone). It also depends on `core/settings` and `core/keybind` (infrastructure layer).

## 핵심 개념

### Standing Orders

모든 프로토콜에 **항상 주입**되는 cross-cutting 메커니즘. 프로토콜과 무관하게 에이전트 행동을 규율한다.

### Protocols

**상호 배타적**으로 전환되는 워크플로우. 한 번에 하나의 프로토콜만 활성화되며, `Alt+N`으로 전환한다.

### ACP Runtime Protocol Switching

ACP 모드에서는 시스템 프롬프트가 최초 1회만 전달되므로, 초기 프롬프트에 **전체 프로토콜 카탈로그**를 포함하고, 매 턴 `<current_protocol>` 태그로 활성 프로토콜을 지정한다. admiral은 `setCliRuntimeContext()`에 빌더 함수(`buildRuntimeContextPrompt`)를 등록하고, provider-stream이 매 턴 user request 텍스트를 인자로 호출해 런타임 태그 + `<user_request>` 래핑이 포함된 완성 prefix를 얻는다.

런타임 태그에는 현재 활성 프로토콜 외에도 함대 상태 정보가 포함됩니다:
- `<current_protocol>`: 현재 활성화된 Admiral 프로토콜 ID.
- `<available_sortie_carriers>` / `<available_squadron_carriers>` / `<available_taskforce_carriers>`: 각 모드에서 사용 가능한 캐리어 ID 목록.
- `<offline_carriers>`: `sortie off` 상태인 캐리어 ID 목록 (콤마 구분). 비어있을 경우 태그가 생략됩니다.

### Dev Mode Base Prompt Injection

`fleet-dev` 모드(boot config `dev: true`)에서는 ACP가 기본적으로 주입하는 `pi-coding-agent`의 시스템 프롬프트(RISEN 컨텍스트) 뒤에 함대 시스템 프롬프트를 추가합니다.
- `fleet/pi-events.ts`의 `before_agent_start` 핸들러가 `event.systemPrompt` 뒤에 `buildSystemPrompt()` 결과를 Append합니다.
- `buildSystemPrompt()`는 `dev` 모드일 경우 코딩 에이전트의 기본 능력을 방해하지 않도록 Fleet persona/role/tone 섹션을 생략하고 Roster와 Protocol 교리만 제공합니다.
- Non-dev 모드에서는 `metaphor`에서 제공하는 함대 전용 페르소나와 역할이 포함됩니다.

## Responsibilities

| Responsibility | Implementation |
|----------------|----------------|
| ACP CLI system prompt composition (`before_agent_start`) | `prompts.ts` — `buildSystemPrompt()`를 통해 함대 지침 합성. `fleet/pi-events.ts`에서 `before_agent_start` 이벤트 발생 시 기본 프롬프트 뒤에 Append 방식으로 등록합니다. |
| ACP runtime context (per-turn prefix) | index.ts — `setCliRuntimeContext(buildRuntimeContextPrompt)` 빌더 등록. 매 턴 `<current_protocol>` 및 함대 가용성 상태 태그를 포함한 컨텍스트를 주입합니다. |
| **Asynchronous Result Handling** | `prompts.ts` — Admiral(제독)이 도구 호출 후 즉시 반환되는 `job_id`를 인식하고, `[carrier:result]` 푸시 신호를 기다리거나 `carrier_jobs` 도구로 결과를 명시적으로 획득하도록 지침을 제공합니다. |
| Protocol 전환 | `index.ts` — `Alt+N` 키바인드, `fleet:admiral:protocol` 커맨드 |
| Settings section ("Admiral") | `index.ts` — registers in Alt+/ popup, owns `admiral` settings key |
| 활성 프로토콜 상태 표시 | `widget.ts` — aboveEditor 위젯 |
| Prompt constants & settings logic | `prompts.ts` — Standing Orders + `PROTOCOL_PREAMBLE` + `buildSystemPrompt()` + `buildRuntimeContextPrompt()`. **PERSONA/TONE 소스는 `metaphor` 패키지에서 import 합니다.** |
| pi 도구 등록 오너쉽 (carriers_sortie / carrier_taskforce / carrier_squadron / carrier_jobs) | `fleet/pi-tools.ts` — shipyard는 각 도구의 `build*ToolConfig()` 팩토리로 기능만 제공하고 `pi.registerTool` 호출은 Fleet PI tool registration module이 수행. `fleet/index.ts`는 이를 호출만 한다. |
| 에디터 테두리 색상 | globalThis `"__pi_hud_editor_border_color__"` 키로 `core/hud`에 간접 통신 |

## Settings

| Key | Type | Description |
|-----|------|-------------|
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
| `index.ts` | admiral 내부 부트 모듈 — 프로토콜/설정/커맨드/`setCliRuntimeContext` wiring 소유, `fleet/index.ts`가 호출 |
| `prompts.ts` | `buildSystemPrompt()` (전체 ACP 지침 동적 합성) 및 `buildRuntimeContextPrompt()` (런타임 태그 합성) 소유. Worldview 토글 여부 및 Dev 모드 여부에 따른 조건부 섹션 주입 로직을 포함합니다. |
| `tool-prompt-manifest/` | `ToolPromptManifest` 레지스트리 및 포맷터. 도구 교리의 Single Source of Truth 관리 |
| `request-directive.ts` | `request_directive` tool — Admiral of the Navy (대원수)에게 전략적 지시를 요청하는 TUI 도구. `REQUEST_DIRECTIVE_MANIFEST` 소유 |
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
| `request_directive` | **Admiral of the Navy (ATN, 대원수)**에게 전략적 지시를 요청합니다. Admiral (제독)이 직접 해결하기 어려운 상황이나 전략적 판단이 필요할 때 사용합니다. `ToolPromptManifest` 패턴을 따르며, admiral이 직접 manifest를 정의하고 등록합니다. |

## 4-Tier Naval Hierarchy (4계층 해군 위계)

이 확장은 아래와 같은 4계층 위계를 기반으로 동작합니다:

1. **Admiral of the Navy (ATN, 대원수)**: **사용자 (User)**. 함대 운영의 최종 의사결정자이자 지시 주체.
2. **Fleet Admiral (사령관)**: `grand-fleet`의 Admiralty LLM 페르소나 (Grand Fleet 모드 전용).
3. **Admiral (제독)**: **워크스페이스 PI 인스턴스 (Host PI)**. 이 확장의 프롬프트 정책을 직접 체화하여 Carrier(함대)를 지휘하는 주체.
4. **Captain (함장)**: 개별 Carrier 에이전트의 지휘관 페르소나.

## Core Rules

- **Top-level orchestrator** — admiral has-a relationship to `fleet/` and `carriers/`.
- **Dependency direction**: `admiral/` 라이브러리 모듈 → `core/settings`, `core/keybind`, `core/agentclientprotocol/provider-types` (시스템 프롬프트 합성 인터페이스), `fleet/shipyard/`, `metaphor/`. 실제 admiral wiring은 `admiral/index.ts`가 소유하고, `fleet/index.ts`는 이를 호출하는 상위 facade다.
- **Tool Doctrine SSOT**: 모든 PI 도구의 교리(Prompt, Guidelines, Schema meta)는 `ToolPromptManifest` 형식을 따른다. 각 도구 소유 모듈(e.g. `shipyard/squadron`, `shipyard/carrier_jobs`)에서 manifest를 정의하고 `registerToolPromptManifest`를 통해 등록한다.
- **Asynchronous Tooling**: All carrier-related tools (sortie, squadron, taskforce) must follow the fire-and-forget pattern, returning only a `job_id`. Admiral ensures that the system prompt guides the agent to use `carrier_jobs` for result inspection.
- **Registration ownership**: Admiral owns prompt/system policy and manifest composition only. Carrier tool registration stays in `extensions/fleet/pi-tools.ts`; `extensions/fleet/index.ts` only calls the registration API.
- **Prompt Decentralization**: `admiral/prompts.ts`는 더 이상 도구별 프롬프트를 하드코딩하지 않는다. 대신 `getAllToolPromptManifests()`를 통해 등록된 모든 manifest를 순회하며 ACP XML 블록을 동적으로 조립한다.
- **에디터 테두리 간접 통신**: globalThis `"__pi_hud_editor_border_color__"` 키를 통해 `core/hud/border-bridge.ts`와 간접 통신.
- **Command naming**: follows `fleet:<domain>:<feature>` form — `fleet:admiral:protocol`. **`metaphor:worldview` 커맨드는 `metaphor` 패키지에서 제공합니다.**
- **Prompt text lives in `prompts.ts`** — `PROTOCOL_PREAMBLE` 가이드는 `prompts.ts`에 둔다. 도구별 교리는 각 도구 모듈의 manifest에 둔다.
- **Settings key is `admiral`** — not `fleet`. **Worldview 관련 설정은 `metaphor` 키를 사용합니다.**
- **Standing Orders는 항상 주입** — 프로토콜 활성 여부와 무관하게 모든 에이전트 세션에 포함.
- **Protocols는 상호 배타적** — 동시에 하나만 활성화. 항상 하나의 프로토콜이 활성 상태.
