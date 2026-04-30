# Admiral Workflow Reference

This document is the operational doctrine for Admiral and Carrier agents working inside this repository during the Fleet capability-flattening migration.

## 1. Current Architecture State

The migration target is already fixed:

- `packages/fleet-core` owns Fleet **domain logic**
- `packages/fleet-core/src/admiralty` owns the internalized **Grand Fleet domain**
- `packages/pi-fleet-extension` owns Pi **capability buckets**

The repository uses this **current physical state**:

- `packages/fleet-core` remains under `packages/fleet-core/src/`
- `packages/fleet-core/src/admiralty` is an internalized domain within `fleet-core` with public subpaths `./admiralty` and `./admiralty/ipc`
- `packages/pi-fleet-extension` capability buckets still remain under `packages/pi-fleet-extension/src/<bucket>/`

Agents must not confuse logical ownership with bucket relocation. `packages/pi-fleet-extension/src/` remains the active physical home, and the old legacy domain folders under it have been removed and must not be recreated.

## 2. Ownership Model

### 2.1 `fleet-core`

`fleet-core` owns:

- Fleet domain orchestration
- prompt composition and doctrine assets
- persona, tone, worldview, operation-name, and directive-refinement domain logic
- Admiral-owned carrier, carrier-jobs, squadron, taskforce, store, and bridge state/data layers under `src/admiral/`
- agent and job domain logic under `src/services/`
- pure runtime stores, ports, and adapter-facing contracts
- shared doctrine/runtime surfaces consumed by extracted leaf packages

Runtime composition is exposed through the package root and `@sbluemin/fleet-core/runtime`. Public service access should flow through `FleetCoreRuntimeContext` domain services; legacy direct subpaths remain migration compatibility only.

`fleet-core` must not own:

- `ExtensionContext`
- `pi.on(...)`
- `pi.registerTool(...)`
- `pi.registerCommand(...)`
- `pi.registerShortcut(...)`
- `pi.registerProvider(...)`
- `pi.sendMessage(...)`
- Pi TUI rendering
- Grand Fleet formation/tmux process management

### 2.2 `fleet-core/src/admiralty`

`fleet-core/src/admiralty` (renamed from `gfleet`) owns:

- Grand Fleet prompt composition and status source logic
- Grand Fleet IPC protocol contracts
- Grand Fleet reporter output helpers, tool specs, text sanitization, and shared types

`fleet-core/src/admiralty` must not own:

- Pi runtime wiring or `@mariozechner/pi-*` imports
- deep imports into `fleet-core`
- any reverse dependency from `fleet-core`
- formation/tmux process management (removed)

### 2.3 `pi-fleet-extension`

`pi-fleet-extension` owns:

- Pi lifecycle registration
- command registration
- keybind registration
- tool registration
- provider registration/stream glue and non-provider session handling
- settings/keybind/log/HUD bridges
- Pi overlays, widgets, editor/footer rendering
- compatibility adapters and push delivery seams

`pi-fleet-extension` must not become a new home for Fleet domain business logic.

## 3. Capability Buckets

In the current layout, Pi ownership is expressed through these buckets:

- `src/bindings/runtime/` — `pi.on(...)` listeners and host event sequencing
- `src/bindings/compat/` — compatibility-only seams, including the pi-ai bridge
- `src/bindings/` — Pi-bound wrappers/adapters over `fleet-core` (config, HUD, jobs, etc.)
- `src/commands/` — slash command registration
- `src/keybinds/` — shortcut registration
- `src/tools/` — tool registration and Pi-side renderer/message wiring
- `src/tui/` — all Pi TUI rendering
- `src/provider/` — provider registration, provider stream wiring, and provider lifecycle glue
- `src/session/` — non-provider Pi session features and active-run-safe wrappers

These are the **current doctrinal homes** even though the package still physically retains `src/`.

## 4. Legacy Folder Interpretation

The former legacy directories below are already removed:

- `packages/pi-fleet-extension/src/fleet/`
- `packages/pi-fleet-extension/src/grand-fleet/`
- `packages/pi-fleet-extension/src/metaphor/`
- `packages/pi-fleet-extension/src/core/`
- `packages/pi-fleet-extension/src/boot/`
- `packages/pi-fleet-extension/src/tui/fleet-wiki/`
- `packages/pi-fleet-extension/src/commands/fleet-wiki/`
- `packages/pi-fleet-extension/src/tools/fleet-wiki/`
- `packages/pi-fleet-extension/src/session/fleet-wiki/`

Agents must not use those historical paths as permission to reintroduce domain-first architecture inside `pi-fleet-extension`.

## 5. Allowed Dependency Direction

The intended dependency direction is:

```text
fleet-wiki
  -> (leaf package; no workspace imports)

fleet-core
  -> admiralty public subpaths

pi-fleet-extension capability buckets
  -> fleet-core public APIs
  -> fleet-core admiralty public APIs
  -> fleet-wiki
  -> Pi runtime / TUI / host facilities
```

Forbidden patterns:

- `fleet-core` importing Pi packages
- `fleet-core` duplicating internal admiralty ownership via a separate package
- `pi-fleet-extension` deep-importing `fleet-core/src/**`
- `pi-fleet-extension` importing Grand Fleet surfaces from the deprecated Fleet Core location
- new pure domain logic landing under `pi-fleet-extension/src/fleet/**`
- new Pi registration code landing inside `fleet-core`

## 6. Operational Guidance For Agents

When editing or reviewing this repo:

1. Ask first whether the behavior is pure Fleet domain logic or Pi host integration.
2. Put pure logic in `fleet-core`.
3. Put Pi lifecycle/registration/rendering in the appropriate capability bucket.
4. If a legacy module mixes both, split by ownership instead of preserving the old directory boundary.
5. Keep documentation and code organization aligned with the active `packages/pi-fleet-extension/src/<bucket>/` layout.

## 7. Compatibility Invariants

The migration does **not** authorize silent behavioral drift. Preserve:

- slash command names
- existing `globalThis` compatibility keys
- carrier completion push semantics
- detached-job acceptance vs completion-push distinction
- MCP/provider FIFO and archive behavior

## 8. Documentation Guidance

When updating docs during this migration:

- describe the **current observable state**
- separate **logical ownership** from **physical bucket placement**
- mention that legacy domain folders have been removed when that context matters
- avoid stating or implying that Pi capability buckets are scheduled to move out of `packages/pi-fleet-extension/src/`
