# fleet

Carrier **framework SDK** (`carrier/`) + 3 captains (claude/codex/gemini) that each operate a carrier + integrated carrier modes and agent tools + model selection + status bar + agent panel.

## Core Rules

- Carrier framework state in `carrier/framework.ts` is **shared via `globalThis`** — Avoid module-level singletons as pi bundles each extension separately.
- `registerCarrier` is the public API for carrier registration (exposed via `core-index.ts`).
- `registerSingleCarrier` is the convenience API for single CLI carrier + PI tool registration (exposed via `core-index.ts`, lives in `carrier/register.ts`).
- Carrier tool prompt text belongs to each captain module (`captains/claude.ts`, `captains/codex.ts`, `captains/gemini.ts`) even if duplicated today — this is intentional to allow future captain-specific role divergence.
- `requestUnifiedAgent` is the public agent execution API exposed via `globalThis["__pi_ua_request__"]`.
- **All execution paths go through `runAgentRequest()`** — Carriers, tools, and external extensions all use `runAgentRequest()` from `operation-runner.ts`. No direct `executeWithPool` calls outside operation-runner.
- Calling `runAgentRequest()` **automatically syncs all UIs**: agent panel column, streaming widget (when panel collapsed), and stream-store data.
- **Same CLI concurrent calls are not supported** — UI layer manages one visible run per CLI.
- Mutual exclusivity between carriers is automatically managed by the framework (`deactivateAll`).
- The agent panel is the main UI for streaming — active single carriers use exclusive view, otherwise the panel falls back to the current visible CLI columns.

## Architecture

### Core / Feature Separation

```
core-index.ts          ← public Facade (captains access Fleet core ONLY through here)
operation-runner.ts    ← unified execution entry point (internal — exposed via core-index.ts)
carrier/               ← Carrier framework SDK (registration, activation, input routing, single-carrier registration)
  ├── types.ts         ← CarrierConfig, CarrierHelpers, CarrierResult, internal state types
  ├── framework.ts     ← registerCarrier, activateCarrier, deactivateCarrier, getActiveCarrierId
  ├── register.ts      ← registerSingleCarrier (carrier + PI tool for individual CLIs)
  ├── prompts.ts       ← carrier가 소유한 프롬프트를 Fleet 컨텍스트로 최소 정제
  └── launch.ts        ← native bridge command builder
internal/
  ├── contracts.ts     ← shared domain types (ColBlock, AgentCol, ServiceSnapshot, etc.)
  ├── agent/           ← executor, client-pool, runtime, session-map, model-config, model-ui, types
  ├── panel/           ← panel state + lifecycle + widget bridge
  ├── streaming/       ← stream store + widget manager
  ├── render/          ← all renderers
  └── service-status/  ← service status monitoring (polling, rendering, store)

captains/              ← 3 captain registrations (depend on Fleet core — never the reverse)
```

### Dependency Principles

- **internal/contracts.ts** is the single source of truth for shared domain types (`ColBlock`, `AgentCol`, `ColStatus`, `CollectedStreamData`, `ServiceSnapshot`, etc.). Streaming, render, and panel modules all import types from here — never cross-reference each other for type definitions.
- **Captains → `core-index.ts` only**: Captains (`captains/`) access Fleet core exclusively via `core-index.ts` (the public Facade). Direct imports from `carrier/`, `internal/`, or `operation-runner.ts` are forbidden in captain files.
  - **Exceptions**: `index.ts` (wiring layer), `types.ts` (public types), `tests/` (unit tests) may access core internals directly.
- **Fleet core modules must never import from `captains/`**.
- **Internal modules reference siblings directly** — e.g., `internal/agent/model-ui.ts` imports from `internal/agent/runtime.ts`, `internal/panel/config.ts`, and `carrier/framework.ts` without going through the facade.
- **index.ts is the wiring layer**: It connects captains to core, performing initialization, registration calls, and session event handling.
- **Service status is internal**: Service status monitoring (polling, rendering) lives in `internal/service-status/` and is directly referenced by sibling internal modules (e.g., `panel/widget-sync.ts` imports the renderer). No injection pattern is needed.
- **Persistence is core-owned**: Session map and model config persistence are managed entirely by `internal/agent/runtime.ts`. Captains never access `sessionStore`, `configDir`, or persistence paths directly — they use facade APIs (`getModelConfig`, `updateModelSelection`, `getSessionId`, etc.). `index.ts` calls `initRuntime(dataDir)` once and `onHostSessionChange(piSessionId)` on PI session events. Runtime files live under `.data/`.

### Unified Execution Pipeline

```
Consumer (captains, external extensions)
  → runAgentRequest() (operation-runner.ts — exposed via core-index.ts)
    → stream-store (data)
    → agent-panel column sync (UI)
    → streaming widget when collapsed (UI)
    → executeWithPool (execution)
  → UnifiedAgentResult
```

### Agent Panel Centric Design

- **Exclusive View**: alt+1/2/3 → Full-width panel for the corresponding agent.
- **Fallback Multi-Column View**: No active carrier + visible runs → panel renders the current visible CLI columns.
- **Compact View**: Panel collapsed + while streaming → 1-line status bar.
- **Frame Color**: Applies `CARRIER_COLORS` of the active carrier.

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point: Wiring only — initialization, registration calls, session events, dependency injection |
| `types.ts` | Public types + globalThis bridge key/interface for `requestUnifiedAgent` |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `core-index.ts` | **Public Facade** — single entry point for captains/wiring → core access. Re-exports the supported boundary used by first-party modules |
| `internal/contracts.ts` | Central domain type definitions (internal) — ColBlock, AgentCol, ColStatus, CollectedStreamData, ServiceSnapshot. **All shared types live here** |
| `operation-runner.ts` | Unified execution layer (internal) — `runAgentRequest`, `exposeAgentApi`. Single `executeWithPool` call site. Auto panel/widget sync |
| `carrier/types.ts` | Carrier framework types — CarrierConfig, CarrierHelpers, CarrierResult, internal state types |
| `carrier/framework.ts` | Carrier framework SDK — `registerCarrier`, `activateCarrier`, `deactivateCarrier`, `getActiveCarrierId`, `onStatusUpdate`, `notifyStatusUpdate`. Manages globalThis shared state, input interception, shortcut registration, message renderer registration |
| `carrier/register.ts` | Single-carrier registration — `registerSingleCarrier` (carrier + PI tool via core APIs) |
| `carrier/prompts.ts` | Carrier가 소유한 프롬프트를 Fleet 컨텍스트로 최소 정제 |
| `carrier/launch.ts` | Carrier 네이티브 브리지 커맨드 중앙 조립 |
| `internal/agent/*` | Internal execution/runtime/session/model modules. Includes `model-ui.ts` (model selection UI + keybind/command registration) |
| `internal/panel/*` | Internal panel state/lifecycle/widget modules |
| `internal/streaming/*` | Internal stream store/widget modules |
| `internal/render/*` | Internal renderer modules |
| `internal/service-status/store.ts` | Service status polling/fetching/store — `attachStatusContext`, `refreshStatusNow` (exposed via `core-index.ts`) |
| `internal/service-status/renderer.ts` | Service status footer token renderer — `renderServiceStatusToken` (used by `panel/widget-sync.ts`) |
| **captains/** | |
| `captains/index.ts` | Barrel — all 3 captain registrations |
| `captains/claude.ts` | Claude captain — own prompt metadata + delegates to `registerSingleCarrier(pi, "claude", metadata)` |
| `captains/codex.ts` | Codex captain — own prompt metadata + delegates to `registerSingleCarrier(pi, "codex", metadata)` |
| `captains/gemini.ts` | Gemini captain — own prompt metadata + delegates to `registerSingleCarrier(pi, "gemini", metadata)` |
