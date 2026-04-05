# fleet

Carrier **framework SDK** (`shipyard/carrier/`) + N carriers (e.g. genesis/sentinel/vanguard, dynamically registered) that each operate a carrier + integrated carrier modes and agent tools + model selection + Status Bar + Agent Panel.

The number of carriers is determined at runtime by the number of registered carriers in `carriers/`. Each carrier specifies a `slot` number which determines its panel column position and inline navigation order automatically.

## Core Rules

- Carrier framework state in `shipyard/carrier/framework.ts` is **shared via `globalThis`** — Avoid module-level singletons as pi bundles each extension separately.
- `registerCarrier` is the public API for carrier registration (re-exported via `index.ts`).
- `registerSingleCarrier` is the convenience API for single CLI carrier registration (re-exported via `index.ts`, lives in `shipyard/carrier/register.ts`). It registers the carrier in the framework with prompt metadata but does **not** register a PI tool — all tool delegation goes through `carriers_sortie`.
- Carrier prompt text belongs to each carrier module (`carriers/genesis.ts`, `carriers/sentinel.ts`, `carriers/vanguard.ts`) even if duplicated today — this is intentional to allow future carrier-specific role divergence. These prompts are stored in `CarrierConfig` and dynamically synthesized into `carriers_sortie`'s promptGuidelines at registration time.
- **`carriers_sortie` is the sole PI tool for carrier delegation** — there are no individual carrier tools (genesis, sentinel, vanguard). PI delegates all tasks through `carriers_sortie` with `minItems: 1`.
- `requestUnifiedAgent` is the public agent execution API exposed via `globalThis["__pi_ua_request__"]`.
- **All execution paths go through `runAgentRequest()`** — Carriers, tools, and external extensions all use `runAgentRequest()` from `operation-runner.ts`. No direct `executeWithPool` calls outside operation-runner.
- Calling `runAgentRequest()` **automatically syncs all UIs**: Agent Panel column, Streaming Widget (when panel collapsed), and stream-store data.
- **carrierId vs cliType**: `carrierId` (string) is the unique carrier identity used for pool keys, session keys, and panel column identity. `cliType` (CliType) is the CLI binary to execute. Multiple carriers can share the same `cliType` while maintaining fully isolated sessions and connections. **`cliType` can be dynamically changed and persisted at runtime, and `defaultCliType` preserves the original CLI type.**
- **Slot-based ordering**: Each carrier's `slot` determines its panel column position and inline navigation order. Slots must be unique across all registered carriers. **When `cliType` changes, the sorting order and theme color of the corresponding CLI type are immediately reflected.**
- **carriers_sortie call instance isolation**: The `carriers_sortie` tool uses `toolCallId` as the `sortieKey` to isolate state (progress, streaming content, result cache) per call. This prevents UI interference and redundant content output during concurrent/sequential calls.
- **Dynamic CliType Overrides**: You can change the CLI type of a specific carrier at runtime via `updateCarrierCliType`. The changed state is saved in `states.json` and maintained after restart. **When switching CLI types, the current model, reasoning effort, and budget tokens are cached (`perCliSettings`) and automatically restored when returning to that CLI type (with validation against the new provider's capabilities).**
- **Same carrierId concurrent calls are not supported** — UI layer manages one visible run per carrierId.
- Mutual exclusivity between carriers is automatically managed by the framework (`deactivateAll`).
- The Agent Panel is the main UI for streaming — active single carriers use exclusive view, otherwise the panel falls back to the current visible CLI columns.

## Architecture

### Core / Feature Separation

```
index.ts               ← extension entry point + public Facade re-exports
operation-runner.ts    ← unified execution entry point (internal — exposed via index.ts)
shipyard/carrier/      ← Carrier framework SDK + carrier visual representation (registration, activation, input routing, status rendering)
  ├── types.ts         ← CarrierConfig(defaultCliType), CarrierHelpers, CarrierResult, internal state types(pendingCliTypeOverrides)
  ├── framework.ts     ← registerCarrier, activateCarrier, updateCarrierCliType, setPendingCliTypeOverrides
  ├── register.ts      ← registerSingleCarrier (dynamic cliType reference and defaultCliType auto-configuration)
  ├── prompts.ts       ← carriers_sortie tool base prompt management
  ├── sortie.ts        ← carriers_sortie (sole carrier delegation PI tool) registration + dynamic prompt synthesis
  ├── status-overlay.ts ← Carrier status bar overlay (supports cliType change mode, 'c' key binding)
  └── launch.ts        ← native bridge command builder
shipyard/store.ts    ← Unified fleet persistence store (states.json)
panel/             ← panel state(findColIndex) + lifecycle + widget bridge + panel domain types
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
- **Persistence is dual-layered**:
  - **Core persistence** (`core/agent/runtime.ts`) manages the data directory and **session-only** maps (mapping host PI session IDs to individual carrier session IDs).
  - **Fleet persistence** (`shipyard/store.ts`) manages the **fleet-wide state** in a single `states.json` file. This includes model selection, `sortieDisabled` status, and `cliTypeOverrides`.
- `shipyard/store.ts` is the single source of truth for persistent fleet configuration. `initStore(dataDir)` must be called in `fleet/index.ts` immediately after `initRuntime(dataDir)`. All writes to `states.json` use an atomic tmp+rename pattern to prevent corruption.

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
- **Frame Color**: Applies `CARRIER_COLORS` of the active carrier. **If `cliType` has changed, the color of the changed type is followed.**

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point + public Facade — wiring, initialization, session events, dependency injection, export-only public re-exports |
| `types.ts` | Public types + globalThis bridge key/interface for `requestUnifiedAgent` |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `streaming/types.ts` | Streaming domain types — ColBlock, ColStatus, CollectedStreamData |
| `panel/types.ts` | Panel domain types — AgentCol |
| `operation-runner.ts` | Unified execution layer (internal) — `runAgentRequest`, `exposeAgentApi`. Single `executeWithPool` call site. Auto panel/widget sync |
| `shipyard/carrier/types.ts` | Carrier framework types — CarrierConfig (added defaultCliType), CarrierHelpers, CarrierResult, internal state types (added pendingCliTypeOverrides) |
| `shipyard/carrier/framework.ts` | Carrier framework SDK — `registerCarrier`, `activateCarrier`, `deactivateCarrier`, `getActiveCarrierId`, `updateCarrierCliType` (runtime CLI change), `setPendingCliTypeOverrides` (initial override configuration), `onStatusUpdate`, `notifyStatusUpdate`. Manages globalThis shared state, input interception, shortcut registration, message renderer registration |
| `shipyard/carrier/register.ts` | Single-carrier registration — `registerSingleCarrier` (carrier framework + prompt metadata, no PI tool). Performs dynamic cliType reference and `defaultCliType` auto-configuration in `onExecute`. |
| `shipyard/carrier/prompts.ts` | carriers_sortie prompt / schema management (Tier 1 · Tier 2 request assembly) |
| `shipyard/carrier/sortie.ts` | Carrier Sortie tool — sole carrier delegation PI tool. Through **call instance isolation (sortieKey)** and **runId-based streaming filtering**, it displays unified progress/results without UI interference even when multiple calls run simultaneously. |
| `shipyard/store.ts` | Unified fleet persistence store — `initStore`, `loadModels`, `saveModels`, `updateModelSelection` (with Task Force/CLI settings preservation), `getPerCliSettings`/`savePerCliSettings` (CLI preference caching), `loadSortieDisabled`, `saveSortieDisabled`, `loadCliTypeOverrides`, `saveCliTypeOverrides`. Single source of truth for all fleet persistent state in `states.json`. |

| `shipyard/carrier/status-overlay.ts` | Status Overlay UI — Added `"cliType"` to `OverlayMode` and provides CLI type change functionality via the `c` key. Supports `updateCliType`, `getDefaultCliType` callbacks. |

| `shipyard/carrier/model-ui.ts` | Model selection UI — model selection TUI component + keybind/command registration |
| `shipyard/carrier/status-renderer.ts` | Carrier status segment renderer — renders carrier icon + name + status-based color. Integrates with `setWidget("fleet-carrier-status", ..., { placement: "aboveEditor" })`. |
| `shipyard/carrier/launch.ts` | Central assembly of carrier native bridge commands |
| `panel/state.ts` | Panel global state management — provides functionality to directly look up the column index of a specific carrier via `findColIndex(carrierId)`. |
| `panel/*` | Panel state/lifecycle/widget modules |
| `streaming/*` | Stream store/widget modules |
| `render/*` | Renderer modules |
| **core/agent/** | **(Core Infrastructure)** — See `extensions/core/agent/AGENTS.md` for details |
| **carriers/** | **(Separated)** — now at `extensions/carriers/`. See `extensions/carriers/AGENTS.md` |
