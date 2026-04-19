# fleet

Carrier **framework SDK** (`shipyard/carrier/`) + Admiral/Bridge/Carrier wiring + integrated carrier modes and agent tools + model selection + Status Bar + Agent Panel.

The number of carriers is determined at runtime by the carrier modules registered from `fleet/carriers/index.ts`, which is booted by `fleet/index.ts`. Each carrier specifies a `slot` number which determines its panel column position and inline navigation order automatically.

## Core Rules

- Carrier framework state in `shipyard/carrier/framework.ts` is **shared via `globalThis`** — Avoid module-level singletons as pi bundles each extension separately.
- `registerCarrier` is the public API for carrier registration (re-exported via `index.ts`).
- `registerSingleCarrier` is the convenience API for single CLI carrier registration (re-exported via `index.ts`, lives in `shipyard/carrier/register.ts`). It registers the carrier in the framework with prompt metadata but does **not** register a PI tool — all tool delegation goes through `carriers_sortie`.
- Carrier prompt text belongs to each carrier module (`carriers/genesis.ts`, `carriers/sentinel.ts`, `carriers/vanguard.ts`) even if duplicated today — this is intentional to allow future carrier-specific role divergence. These prompts are stored in `CarrierConfig` and dynamically synthesized into `carriers_sortie`'s promptGuidelines at registration time.
- **`carriers_sortie` is the sole PI tool for carrier delegation** — there are no individual carrier tools (genesis, sentinel, vanguard). PI delegates all tasks through `carriers_sortie` with `minItems: 1`.
- `requestUnifiedAgent` is the public agent execution API exposed via `globalThis["__pi_ua_request__"]`.
- **All execution paths go through `runAgentRequest()`** — Carriers, tools, and external extensions all use `runAgentRequest()` from `operation-runner.ts`. No direct `executeWithPool` calls outside operation-runner. **`UnifiedAgentRequestOptions`는 `systemPrompt` 필드를 노출하지 않으며, 시스템 지침은 `admiral`의 전역 설정을 따릅니다.**
- **Tool Doctrine SSOT**: 모든 PI 도구(sortie, squadron, taskforce)의 교리는 각 도구 모듈의 `ToolPromptManifest`에 정의되며, admiral이 이를 ACP XML 블록으로 동적 조립한다.
- Calling `runAgentRequest()` **automatically syncs all UIs**: Agent Panel column, Streaming Widget (when panel collapsed), and stream-store data.
- **carrierId vs cliType**: `carrierId` (string) is the unique carrier identity used for pool keys, session keys, and panel column identity. `cliType` (CliType) is the CLI binary to execute. Multiple carriers can share the same `cliType` while maintaining fully isolated sessions and connections. **`cliType` can be dynamically changed and persisted at runtime, and `defaultCliType` preserves the original CLI type.**
- **Slot-based ordering**: Each carrier's `slot` determines its panel column position and inline navigation order. Slots must be unique across all registered carriers. **When `cliType` changes, the sorting order and theme color of the corresponding CLI type are immediately reflected.**
- **carriers_sortie call instance isolation**: The `carriers_sortie` tool uses `toolCallId` as the `sortieKey` to isolate state (progress, streaming content, result cache) per call. This prevents UI interference and redundant content output during concurrent/sequential calls.
- **Carrier Squadron (Parallel Execution)**: Same-type carriers can be grouped into a **Squadron** (toggled via 'S' key in Status Overlay) for parallel task processing.
  - `squadronEnabled` carriers are **automatically excluded** from `carriers_sortie` to prevent session conflicts.
  - Squadrons use `executeOneShot` for fire-and-forget execution (no persistent session/history).
  - A hard cap of **5 concurrent instances** is enforced per squadron.
  - Active squadrons are indicated by a `[SQ]` tag in the Status Bar.
- **Dynamic CliType Overrides**: You can change the CLI type of a specific carrier at runtime via `updateCarrierCliType`. The changed state is saved in `states.json` and maintained after restart. **When switching CLI types, the current model, reasoning effort, and budget tokens are cached (`perCliSettings`) and automatically restored when returning to that CLI type (with validation against the new provider's capabilities).**
- **Batch CLI Control**: Supports batch switching of all carriers belonging to a specific CLI type to another type (`Shift+C` in Status Overlay) and restoring all carriers to their source-level default CLI types (`Shift+R` in Status Overlay).
- **Same carrierId concurrent calls are not supported** — UI layer manages one visible run per carrierId.
- The Agent Panel is the main UI for streaming — multi-column is the default, and `Ctrl+Enter` opens a panel-local 1-column detail view for the selected carrier.

## Architecture

### Core / Feature Separation

```
index.ts               ← extension entry point + public Facade re-exports + admiral/bridge/carrier wiring
operation-runner.ts    ← unified execution entry point (internal — exposed via index.ts)
admiral/               ← Admiral prompt-policy library (prompts, protocols, standing-orders, widget, request-directive)
bridge/                ← Integrated Fleet Bridge package (ACP overlay shell + Agent Panel + Carrier UI overlays + Renderer + Streaming store)
  ├── acp-shell/       ← ACP overlay shell (Alt+T)
  ├── carrier-ui/      ← Status Overlay & Carrier UI overlays (Alt+O)
  ├── panel/           ← Agent Panel state & lifecycle (Alt+P)
  ├── streaming/       ← Stream store & domain types
  └── render/          ← Panel rendering engine
carriers/              ← default carrier definitions registered by `carriers/index.ts`, booted from `fleet/index.ts`
shipyard/carrier/      ← Carrier framework SDK + carrier visual representation
  ├── types.ts         ← CarrierConfig, internal state types (오버레이 전용 타입은 bridge/carrier-ui/로 분리)
  ├── framework.ts     ← registerCarrier, updateCarrierCliType, setPendingCliTypeOverrides
  ├── register.ts      ← registerSingleCarrier
  ├── prompts.ts       ← carriers_sortie tool base prompt management
  ├── sortie.ts        ← carriers_sortie ToolDefinition factory + dynamic prompt synthesis
shipyard/squadron/     ← Carrier Squadron logic (parallel one-shot execution)
shipyard/store.ts      ← Unified fleet persistence store (states.json)
```

### Dependency Principles

- **Shared domain types** are distributed to their owning subpackages: `bridge/streaming/types.ts` owns `ColBlock`, `ColStatus`, `CollectedStreamData`; `bridge/panel/types.ts` owns `AgentCol`; `bridge/carrier-ui/types.ts` owns overlay domain types. Common types (`ProviderKey`, `HealthStatus`, `ServiceSnapshot`) are imported directly from **`core/agentclientprotocol/types.ts`**.
- **One-way dependency**: The **`core`** layer (including `core/agentclientprotocol/`) must never reference the **`fleet`** layer. `fleet` → `core` is the only allowed direction.
- **Carrier definitions live under `fleet/carriers/`** and are wired only through `fleet/carriers/index.ts`, which is booted from `fleet/index.ts`. Framework internals (`shipyard/*`, `bridge/panel/*`, `bridge/render/*`, `bridge/streaming/*`) must remain unaware of carrier persona modules.
- **Only `fleet/index.ts` may import from `fleet/carriers/index.ts`, `fleet/admiral/index.ts`, and `fleet/bridge/index.ts` for top-level wiring.**
- **Subpackage modules reference siblings directly** — e.g., `bridge/panel/config.ts` imports from `shipyard/carrier/framework.ts` without going through the facade.
- **`index.ts` is the only public facade**: It owns extension wiring plus export-only public re-exports. Keep business logic in `shipyard/carrier/`, `bridge/panel/`, `bridge/render/`, `bridge/streaming/`, `shipyard/squadron/`, and `operation-runner.ts`.
- **Service status lives in core**: Service status monitoring (polling, rendering) lives in **`core/agentclientprotocol/service-status/`**. During the Wave 4 transition, `fleet/index.ts` continues to inject the callback into the current core service-status store implementation so UI refreshes remain decoupled from core.
- **Persistence is dual-layered**:
  - **Core persistence** (`core/agentclientprotocol/runtime.ts`) manages the data directory and **session-only** maps (mapping host PI session IDs to individual carrier session IDs).
  - **Fleet persistence** (`shipyard/store.ts`) manages the **fleet-wide state** in a single `states.json` file. This includes model selection, `sortieDisabled`, `squadronEnabled` status, and `cliTypeOverrides`.
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

- **Detail View**: `Ctrl+Enter` on the selected inline slot → Full-width 1-column panel for the corresponding carrier.
- **Multi-Column View**: Default panel mode — renders the current visible CLI columns.
- **Compact View**: Panel collapsed + while streaming → 1-line Streaming Widget.
- **Frame Color**: Applies `CARRIER_COLORS` of the detail-view carrier. **If `cliType` has changed, the color of the changed type is followed.**

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point + public Facade — wiring, initialization, session events, dependency injection, export-only public re-exports |
| `types.ts` | Public types + globalThis bridge key/interface for `requestUnifiedAgent` |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `bridge/streaming/types.ts` | Streaming domain types — ColBlock, ColStatus, CollectedStreamData |
| `bridge/panel/types.ts` | Panel domain types — AgentCol |
| `bridge/carrier-ui/types.ts` | Overlay domain types — CarrierCliType, ModelSelection, OverlayState, etc. |
| `operation-runner.ts` | Unified execution layer (internal) — `runAgentRequest`, `exposeAgentApi`. Single `executeWithPool` call site. Auto panel/widget sync |
| `shipyard/carrier/types.ts` | Carrier framework types — CarrierConfig, internal state types (오버레이 전용 타입은 bridge/carrier-ui/types.ts로 분리) |
| `shipyard/carrier/framework.ts` | Carrier framework SDK — `registerCarrier`, `updateCarrierCliType`, `setPendingCliTypeOverrides`. Manages globalThis shared state, registration order, and message renderer registration. |
| `shipyard/carrier/register.ts` | Single-carrier registration — `registerSingleCarrier`. Performs dynamic cliType reference and `defaultCliType` auto-configuration. |
| `shipyard/carrier/prompts.ts` | `SORTIE_MANIFEST` (`ToolPromptManifest`) 소유 |
| `shipyard/carrier/sortie.ts` | Carrier Sortie tool — sole carrier delegation PI tool. Through **call instance isolation (sortieKey)** and **runId-based streaming filtering**, it displays unified progress/results without UI interference even when multiple calls run simultaneously. |
| `shipyard/squadron/index.ts` | Squadron module entry point — registration and public API |
| `shipyard/squadron/squadron.ts` | Squadron execution logic — manages parallel `executeOneShot` calls. |
| `shipyard/taskforce/taskforce.ts` | Task Force execution logic — cross-backend parallel `executeOneShot` for configured CLIs. |
| `shipyard/squadron/prompts.ts` | `SQUADRON_MANIFEST` (`ToolPromptManifest`) 소유 |
| `shipyard/taskforce/prompts.ts` | `TASKFORCE_MANIFEST` (`ToolPromptManifest`) 소유 |
| `shipyard/squadron/types.ts` | Squadron domain types and interfaces |
| `shipyard/store.ts` | Unified fleet persistence store — `initStore`, `loadModels`, `saveModels`, `updateModelSelection`, `getPerCliSettings`/`savePerCliSettings`, `loadSortieDisabled`, `saveSortieDisabled`, `loadSquadronEnabled`, `saveSquadronEnabled`, `loadCliTypeOverrides`, `saveCliTypeOverrides`. |

| `bridge/carrier-ui/status-overlay.ts` | Status Overlay UI — Supports individual CLI change (`c`), batch CLI transition (`C`), global default restoration (`R`), and squadron toggle (`s`). |

| `bridge/carrier-ui/status-renderer.ts` | Carrier status segment renderer — renders carrier icon + name + status-based color + `[SQ]` tag for active squadrons. |
| `shipyard/carrier/model-ui.ts` | Model selection UI — model selection TUI component + keybind/command registration |
| `bridge/panel/state.ts` | Panel global state management — provides functionality to directly look up the column index of a specific carrier via `findColIndex(carrierId)`. |
| `bridge/acp-shell/*` | ACP overlay shell modules (command, handler, types, boot) |
| `bridge/panel/*` | Panel state/lifecycle/widget modules |
| `bridge/streaming/*` | Stream store/widget modules |
| `bridge/render/*` | Renderer modules |
| **core/agentclientprotocol/** | **(Core Infrastructure)** — See `extensions/core/agentclientprotocol/AGENTS.md` for details |
| **carriers/** | Default carrier definition library consumed by `fleet/carriers/index.ts` and booted by `fleet/index.ts` |
