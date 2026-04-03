# fleet

Carrier **framework SDK** (`shipyard/carrier/`) + N carriers (e.g. genesis/sentinel/vanguard, dynamically registered) that each operate a carrier + integrated carrier modes and agent tools + model selection + Status Bar + Agent Panel.

The number of carriers is determined at runtime by the number of registered carriers in `carriers/`. Each carrier specifies a `slot` number which determines its panel column position and `Alt+{slot}` keybinding automatically.

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
- **Slot-based keybindings**: Each carrier registers `Alt+{slot}` automatically based on the `slot` field in `CarrierConfig`. Slots must be unique across all registered carriers.
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
internal/
  ├── contracts.ts     ← shared domain types (ColBlock, AgentCol, ServiceSnapshot, etc.)
  ├── agent/           ← executor, client-pool, runtime, session-map, model-config, model-ui, types
  ├── panel/           ← panel state + lifecycle + widget bridge
  ├── streaming/       ← stream store + widget manager
  ├── render/          ← panel rendering engine (panel layout, block transform, message renderers)
  └── service-status/  ← service status monitoring (polling, rendering, store)

carriers/              ← (REMOVED — now at extensions/carriers/)
```

### Dependency Principles

- **internal/contracts.ts** is the single source of truth for shared domain types (`ColBlock`, `AgentCol`, `ColStatus`, `CollectedStreamData`, `ServiceSnapshot`, etc.). Streaming, render, and panel modules all import types from here — never cross-reference each other for type definitions.
- **Carriers have been separated into `carriers/`** — an independent extension at `extensions/carriers/`. Carrier files reside in the standalone `carriers/` extension, not in `fleet/`. See `extensions/carriers/AGENTS.md` for carrier rules.
- **Fleet core modules must never import from `carriers/`**.
- **Internal modules reference siblings directly** — e.g., `internal/agent/model-ui.ts` imports from `internal/agent/runtime.ts`, `internal/panel/config.ts`, and `shipyard/carrier/framework.ts` without going through the facade.
- **`index.ts` is the only public facade**: It owns extension wiring plus export-only public re-exports. Keep business logic in `shipyard/carrier/`, `internal/`, and `operation-runner.ts`.
- **Service status is internal**: Service status monitoring (polling, rendering) lives in `internal/service-status/` and is directly referenced by sibling internal modules (e.g., `panel/widget-sync.ts` imports the renderer). No injection pattern is needed.
- **Persistence is core-owned**: Session map and model config persistence are managed entirely by `internal/agent/runtime.ts`. Carriers never access `sessionStore`, `configDir`, or persistence paths directly — they use facade APIs (`getModelConfig`, `updateModelSelection`, `getSessionId`, etc.). `index.ts` calls `initRuntime(dataDir)` once and `onHostSessionChange(piSessionId)` on PI session events. Runtime files live under `.data/`.

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

- **Exclusive View**: alt+{slot} → Full-width panel for the corresponding agent.
- **Fallback Multi-Column View**: No active carrier + visible runs → panel renders the current visible CLI columns.
- **Compact View**: Panel collapsed + while streaming → 1-line Streaming Widget.
- **Frame Color**: Applies `CARRIER_COLORS` of the active carrier.

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point + public Facade — wiring, initialization, session events, dependency injection, export-only public re-exports |
| `types.ts` | Public types + globalThis bridge key/interface for `requestUnifiedAgent` |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `internal/contracts.ts` | Central domain type definitions (internal) — ColBlock, AgentCol, ColStatus, CollectedStreamData, ServiceSnapshot. **All shared types live here** |
| `operation-runner.ts` | Unified execution layer (internal) — `runAgentRequest`, `exposeAgentApi`. Single `executeWithPool` call site. Auto panel/widget sync |
| `shipyard/carrier/types.ts` | Carrier framework types — CarrierConfig, CarrierHelpers, CarrierResult, internal state types |
| `shipyard/carrier/framework.ts` | Carrier framework SDK — `registerCarrier`, `activateCarrier`, `deactivateCarrier`, `getActiveCarrierId`, `onStatusUpdate`, `notifyStatusUpdate`. Manages globalThis shared state, input interception, shortcut registration, message renderer registration |
| `shipyard/carrier/register.ts` | Single-carrier registration — `registerSingleCarrier` (carrier framework + prompt metadata, no PI tool) |
| `shipyard/carrier/prompts.ts` | carrier_sortie 도구 기본 프롬프트 관리 |
| `shipyard/carrier/sortie.ts` | Carrier Sortie 도구 — 유일한 carrier 위임 PI 도구, 동적 프롬프트 합성, 통합 진행/결과 표시 |
| `shipyard/carrier/footer-renderer.ts` | Carrier footer segment renderer — carrier 아이콘 + 이름 + 상태별 색상을 footer 세그먼트로 렌더링 |
| `shipyard/carrier/launch.ts` | Carrier 네이티브 브리지 커맨드 중앙 조립 |
| `internal/agent/*` | Internal execution/runtime/session/model modules. Includes `model-ui.ts` (model selection UI + keybind/command registration) |
| `internal/panel/*` | Internal panel state/lifecycle/widget modules |
| `internal/streaming/*` | Internal stream store/widget modules |
| `internal/render/*` | Internal renderer modules |
| `internal/service-status/store.ts` | Service status polling/fetching/store — `attachStatusContext`, `refreshStatusNow` (exposed via `index.ts`) |
| `internal/service-status/renderer.ts` | Service status footer token renderer — `renderServiceStatusToken` (used by `panel/widget-sync.ts`) |
| **carriers/** | **(Separated)** — now at `extensions/carriers/`. See `extensions/carriers/AGENTS.md` |
