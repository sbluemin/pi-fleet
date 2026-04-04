# fleet

Carrier **framework SDK** (`shipyard/carrier/`) + N carriers (e.g. genesis/sentinel/vanguard, dynamically registered) that each operate a carrier + integrated carrier modes and agent tools + model selection + Status Bar + Agent Panel.

The number of carriers is determined at runtime by the number of registered carriers in `carriers/`. Each carrier specifies a `slot` number which determines its panel column position and inline navigation order automatically.

## Core Rules

- Carrier framework state in `shipyard/carrier/framework.ts` is **shared via `globalThis`** — Avoid module-level singletons as pi bundles each extension separately.
- `registerCarrier` is the public API for carrier registration (re-exported via `index.ts`).
- `registerSingleCarrier` is the convenience API for single CLI carrier registration (re-exported via `index.ts`, lives in `shipyard/carrier/register.ts`). It registers the carrier in the framework with prompt metadata but does **not** register a PI tool — all tool delegation goes through `carrier_sortie`.
- Carrier prompt text belongs to each carrier module (`carriers/genesis.ts`, `carriers/sentinel.ts`, `carriers/vanguard.ts`) even if duplicated today — this is intentional to allow future carrier-specific role divergence. These prompts are stored in `CarrierConfig` and dynamically synthesized into `carrier_sortie`'s promptGuidelines at registration time.
- **`carrier_sortie` is the sole PI tool for carrier delegation** — there are no individual carrier tools (genesis, sentinel, vanguard). PI delegates all tasks through `carrier_sortie` with `minItems: 1`.
- `requestUnifiedAgent` is the public agent execution API exposed via `globalThis["__pi_ua_request__"]`.
- **All execution paths go through `runAgentRequest()`** — Carriers, tools, and external extensions all use `runAgentRequest()` from `operation-runner.ts`. No direct `executeWithPool` calls outside operation-runner.
- Calling `runAgentRequest()` **automatically syncs all UIs**: Agent Panel column, Streaming Widget (when panel collapsed), and stream-store data.
- **carrierId vs cliType**: `carrierId` (string) is the unique carrier identity used for pool keys, session keys, and panel column identity. `cliType` (CliType) is the CLI binary to execute. Multiple carriers can share the same `cliType` while maintaining fully isolated sessions and connections.
- **Slot-based ordering**: Each carrier's `slot` determines its panel column position and inline navigation order. Slots must be unique across all registered carriers.
- **carrier_sortie 호출 인스턴스 격리**: `carrier_sortie` 도구는 `toolCallId`를 `sortieKey`로 사용하여 호출 단위로 상태(진행률, 스트리밍 콘텐츠, 결과 캐시)를 격리합니다. 이를 통해 동시/연속 호출 시 UI 간섭과 콘텐츠 중복 출력을 방지합니다.
- **Same carrierId concurrent calls are not supported** — UI layer manages one visible run per carrierId.
- Mutual exclusivity between carriers is automatically managed by the framework (`deactivateAll`).
- The Agent Panel is the main UI for streaming — active single carriers use exclusive view, otherwise the panel falls back to the current visible CLI columns.

## Architecture

### Core / Feature Separation

```
index.ts               ← extension entry point + public Facade re-exports
operation-runner.ts    ← unified execution entry point (internal — exposed via index.ts)
shipyard/carrier/      ← Carrier framework SDK + carrier visual representation (registration, activation, input routing, footer rendering)
  ├── types.ts         ← CarrierConfig, CarrierHelpers, CarrierResult, internal state types
  ├── framework.ts     ← registerCarrier, activateCarrier, deactivateCarrier, getActiveCarrierId
  ├── register.ts      ← registerSingleCarrier (carrier framework registration + prompt metadata)
  ├── prompts.ts       ← carrier_sortie 도구 기본 프롬프트 관리
  ├── sortie.ts      ← carrier_sortie (유일한 carrier 위임 PI 도구) 등록 + 동적 프롬프트 합성
  └── launch.ts        ← native bridge command builder
panel/             ← panel state + lifecycle + widget bridge + panel domain types
streaming/         ← stream store + streaming domain types (ColBlock, ColStatus, CollectedStreamData)
render/            ← panel rendering engine (panel layout, block transform, message renderers)

carriers/              ← (REMOVED — now at extensions/carriers/)
```

### Dependency Principles

- **Shared domain types** are distributed to their owning subpackages: `streaming/types.ts` owns `ColBlock`, `ColStatus`, `CollectedStreamData`; `panel/types.ts` owns `AgentCol`. Common types (`ProviderKey`, `HealthStatus`, `ServiceSnapshot`) are imported directly from **`core/agent/types.ts`**.
- **One-way dependency**: The **`core`** layer (including `core/agent`) must never reference the **`fleet`** layer. `fleet` → `core` is the only allowed direction.
- **Carriers have been separated into `carriers/`** — an independent extension at `extensions/carriers/`. Carrier files reside in the standalone `carriers/` extension, not in `fleet/`. See `extensions/carriers/AGENTS.md` for carrier rules.
- **Fleet core modules must never import from `carriers/`**.
- **Subpackage modules reference siblings directly** — e.g., `panel/config.ts` imports from `shipyard/carrier/framework.ts` without going through the facade.
- **`index.ts` is the only public facade**: It owns extension wiring plus export-only public re-exports. Keep business logic in `shipyard/carrier/`, `panel/`, `render/`, `streaming/`, and `operation-runner.ts`.
- **Service status lives in core**: Service status monitoring (polling, rendering) lives in **`core/agent/service-status/`**. `fleet/index.ts` injects a callback into `core/agent/service-status/store.ts` to trigger fleet UI updates without core needing to know about fleet.
- **Persistence is core-owned**: Session map and model config persistence are managed entirely by **`core/agent/runtime.ts`**. Runtime files live under `.data/`.

### Unified Execution Pipeline

```
Consumer (carriers, external extensions)
  → runAgentRequest() (operation-runner.ts — exposed via index.ts)
    → stream-store (data)
    → Agent Panel column sync (UI)
    → Streaming Widget when collapsed (UI)
    → executeWithPool (execution)
  → UnifiedAgentResult
```

### Agent Panel Centric Design

- **Exclusive View**: `Ctrl+Enter` on the selected inline slot → Full-width panel for the corresponding agent.
- **Fallback Multi-Column View**: No active carrier + visible runs → panel renders the current visible CLI columns.
- **Compact View**: Panel collapsed + while streaming → 1-line Streaming Widget.
- **Frame Color**: Applies `CARRIER_COLORS` of the active carrier.

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point + public Facade — wiring, initialization, session events, dependency injection, export-only public re-exports |
| `types.ts` | Public types + globalThis bridge key/interface for `requestUnifiedAgent` |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `streaming/types.ts` | Streaming domain types — ColBlock, ColStatus, CollectedStreamData |
| `panel/types.ts` | Panel domain types — AgentCol |
| `operation-runner.ts` | Unified execution layer (internal) — `runAgentRequest`, `exposeAgentApi`. Single `executeWithPool` call site. Auto panel/widget sync |
| `shipyard/carrier/types.ts` | Carrier framework types — CarrierConfig, CarrierHelpers, CarrierResult, internal state types |
| `shipyard/carrier/framework.ts` | Carrier framework SDK — `registerCarrier`, `activateCarrier`, `deactivateCarrier`, `getActiveCarrierId`, `onStatusUpdate`, `notifyStatusUpdate`. Manages globalThis shared state, input interception, shortcut registration, message renderer registration |
| `shipyard/carrier/register.ts` | Single-carrier registration — `registerSingleCarrier` (carrier framework + prompt metadata, no PI tool) |
| `shipyard/carrier/prompts.ts` | carrier_sortie 도구 기본 프롬프트 관리 |
| `shipyard/carrier/sortie.ts` | Carrier Sortie 도구 — 유일한 carrier 위임 PI 도구. **호출 인스턴스 격리(sortieKey)** 및 **runId 기반 스트리밍 필터링**을 통해 여러 호출이 동시에 실행되어도 UI 간섭 없이 통합 진행/결과를 표시합니다. |
| `shipyard/carrier/model-ui.ts` | Model selection UI — model selection TUI component + keybind/command registration |
| `shipyard/carrier/footer-renderer.ts` | Carrier footer segment renderer — carrier 아이콘 + 이름 + 상태별 색상을 footer 세그먼트로 렌더링 |
| `shipyard/carrier/launch.ts` | Carrier 네이티브 브리지 커맨드 중앙 조립 |
| `panel/*` | Panel state/lifecycle/widget modules |
| `streaming/*` | Stream store/widget modules |
| `render/*` | Renderer modules |
| **core/agent/** | **(Core Infrastructure)** — See `extensions/core/agent/AGENTS.md` for details |
| **carriers/** | **(Separated)** — now at `extensions/carriers/`. See `extensions/carriers/AGENTS.md` |
