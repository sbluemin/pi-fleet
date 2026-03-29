# fleet (unified-agent-direct)

Direct mode **framework** + Direct modes for 4 CLIs (claude/codex/gemini/all) + individual agent tools + model selection + status bar + agent panel.

## Core Rules

- State in `modes/framework.ts` is **shared via `globalThis`** — Avoid module-level singletons as pi bundles each extension separately.
- `registerCustomDirectMode` is the public API for mode registration.
- `requestUnifiedAgent` is the public agent execution API exposed via `globalThis["__pi_ua_request__"]`.
- **All execution paths go through `runAgentRequest()`** — Direct modes, tools, and external extensions all use `runAgentRequest()` from `core/`. No direct `executeWithPool` calls outside orchestrator.
- Calling `runAgentRequest()` **automatically syncs all UIs**: agent panel column, streaming widget (when panel collapsed), and stream-store data.
- **Same CLI concurrent calls are not supported** — UI layer manages one visible run per CLI.
- Mutual exclusivity between modes is automatically managed by the framework (`deactivateAll`).
- The agent panel is the main UI for streaming — individual CLIs use exclusive view, 'All' uses a 3-split view.

## Architecture

### Core / Feature Separation

```
core/  (infrastructure — NO reverse deps to features)
  ├── index.ts          ← public Facade (features access core ONLY through here)
  ├── contracts.ts      ← shared domain types (ColBlock, AgentCol, ServiceSnapshot, etc.) — internal
  ├── orchestrator.ts   ← unified execution entry point (internal — exposed via index.ts)
  ├── agent/            ← executor, client-pool, runtime, session-map, model-config, types
  ├── panel/            ← panel state + lifecycle + widget bridge
  ├── streaming/        ← stream store + widget manager
  └── render/           ← all renderers

features (depend on core — never the reverse):
  ├── modes/            ← direct mode framework + 4 CLI modes
  ├── tools/            ← PI tool registration
  ├── models/            ← model selection UI
  ├── status/           ← service status monitoring
  └── shell/            ← agent popup command builder
```

### Dependency Principles

- **core/contracts.ts** is the single source of truth for shared domain types (`ColBlock`, `AgentCol`, `ColStatus`, `CollectedStreamData`, `ServiceSnapshot`, etc.). Streaming, render, and panel modules all import types from here — never cross-reference each other for type definitions.
- **Feature → `core/index.ts` only**: Features (`modes/`, `tools/`, `status/`, etc.) access core exclusively via `core/index.ts` (the public Facade). Direct imports from `core/` sub-paths are forbidden in feature files.
  - **Exceptions**: `index.ts` (wiring layer), `types.ts` (public types), `tests/` (unit tests) may access core internals directly.
- **`core/` must never import from feature directories**. Where core needs feature-provided behavior (e.g., service status rendering), **callback injection** via `index.ts` wiring is used.
- **Features must not import from other features**. Each feature directory (`modes/`, `tools/`, `models/`, `status/`, `shell/`) is an isolated module that only depends on `core/index.ts` and shared root files (`constants.ts`, `types.ts`). When a feature needs behavior from another feature, `index.ts` (the wiring layer) injects it via a `deps` parameter — e.g., `models/` receives `getActiveModeId` and `notifyStatusUpdate` from `modes/` through `index.ts`.
- **index.ts is the wiring layer**: It connects features to core via dependency injection (e.g., `setServiceStatusRenderer`) and cross-feature dependencies via `deps` parameters, keeping both core and features unaware of each other's implementations.
- **Persistence is core-owned**: Session map and model config persistence are managed entirely by `core/agent/runtime.ts`. Features never access `sessionStore`, `configDir`, or persistence paths directly — they use facade APIs (`getModelConfig`, `updateModelSelection`, `getSessionId`, etc.). `index.ts` calls `initRuntime(dataDir)` once and `onHostSessionChange(piSessionId)` on PI session events. Runtime files live under `core/.data/`.

### Unified Execution Pipeline

```
Consumer (modes, tools, external extensions)
  → runAgentRequest() (core/orchestrator.ts — exposed via core/index.ts)
    → stream-store (data)
    → agent-panel column sync (UI)
    → streaming widget when collapsed (UI)
    → executeWithPool (execution)
  → UnifiedAgentResult
```

### Agent Panel Centric Design

- **Exclusive View**: alt+1/2/3 → Full-width panel for the corresponding agent.
- **3-Split View**: alt+0 → Simultaneous query to 3 agents.
- **Compact View**: Panel collapsed + while streaming → 1-line status bar.
- **Frame Color**: Applies `DIRECT_MODE_COLORS` of the active mode.

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point: Wiring only — initialization, registration calls, session events, dependency injection |
| `types.ts` | Public types + globalThis bridge key/interface for `requestUnifiedAgent` |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| **core/** | |
| `core/index.ts` | **Public Facade** — single entry point for all feature → core access. Re-exports contracts, orchestrator, model-config, session-map, panel, render APIs |
| `core/contracts.ts` | Central domain type definitions (internal) — ColBlock, AgentCol, ColStatus, CollectedStreamData, ServiceSnapshot, ServiceStatusRendererFn. **All shared types live here** |
| `core/orchestrator.ts` | Unified execution layer (internal) — `runAgentRequest`, `exposeAgentApi`. Single `executeWithPool` call site. Auto panel/widget sync |
| `core/panel/state.ts` | globalThis state singleton + column helpers |
| `core/panel/lifecycle.ts` | Panel lifecycle API (streaming start/stop, column begin/end, toggle, mode) |
| `core/panel/widget-sync.ts` | PI TUI widget bridge (syncWidget, syncFooterStatus). Uses injected renderer callback for service status |
| `core/panel/config.ts` | Model/service config setters + height adjustment + service status renderer injection |
| `core/panel/shortcuts.ts` | Panel keybind registration (alt+p, alt+j, alt+k) |
| `core/streaming/stream-store.ts` | Single source of truth for streaming data (runId-based, blocks canonical) |
| `core/streaming/stream-manager.ts` | Generic widget manager for aboveEditor streaming display |
| `core/render/block-renderer.ts` | Unified block→output rendering engine |
| `core/render/panel-renderer.ts` | Agent panel rendering (full/compact/banner views). Re-exports ColBlock/AgentCol from contracts for backward compat |
| `core/render/footer-renderer.ts` | Footer status bar rendering (pure function, no external deps) |
| `core/render/message-renderers.ts` | Unified message renderer — Direct mode responses, tool results, user input |
| **modes/** | |
| `modes/framework.ts` | Public API (`registerCustomDirectMode`, `activateMode`, `onStatusUpdate`, etc.) |
| `modes/direct.ts` | Registers 3 CLI direct modes. Delegates to `runAgentRequest` |
| `modes/all.ts` | Registers All mode. Panel lifecycle + `runAgentRequest` × 3 |
| `modes/prompts.ts` | All mode cross-report prompt (separated from tool prompts for cohesion) |
| **tools/** | |
| `tools/index.ts` | Registers `claude`, `codex`, `gemini` as individual pi tools. Depends on `core` (via Facade) |
| `tools/prompts.ts` | Tool descriptions, prompt snippets, guidelines |
| **models/** | |
| `models/model-ui.ts` | Model selection UI + keybind/command registration. Receives `getActiveModeId`/`notifyStatusUpdate` via DI from `index.ts` |
| **status/** | |
| `status/` | Service status monitoring (Claude/Codex/Gemini health checks). Renderer injected into core via `setServiceStatusRenderer` |
| **shell/** | |
| `shell/` | Agent popup command builder |
