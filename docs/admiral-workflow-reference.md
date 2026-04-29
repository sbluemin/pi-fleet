# Admiral Workflow Reference

This document is the operational doctrine for Admiral and Carrier agents working inside this repository during the Fleet capability-flattening migration.

## 1. Current Architecture State

The migration target is already fixed:

- `packages/fleet-core` owns Fleet **domain logic**
- `packages/fleet-pi-extension` owns Pi **capability buckets**

The repository uses this **current physical state**:

- `packages/fleet-core` remains under `packages/fleet-core/src/`
- `packages/fleet-pi-extension` capability buckets still remain under `packages/fleet-pi-extension/src/<bucket>/`

Agents must not confuse logical ownership with bucket relocation. `packages/fleet-pi-extension/src/` remains the active physical home, and the old legacy domain folders under it have been removed and must not be recreated.

## 2. Ownership Model

### 2.1 `fleet-core`

`fleet-core` owns:

- Fleet domain orchestration
- prompt composition and doctrine assets
- persona, tone, worldview, operation-name, and directive-refinement domain logic
- carrier, squadron, taskforce, and job domain logic
- bridge state/data layers
- grand-fleet domain logic
- pure runtime stores, ports, and adapter-facing contracts

`fleet-core` must not own:

- `ExtensionContext`
- `pi.on(...)`
- `pi.registerTool(...)`
- `pi.registerCommand(...)`
- `pi.registerShortcut(...)`
- `pi.registerProvider(...)`
- `pi.sendMessage(...)`
- Pi TUI rendering

### 2.2 `fleet-pi-extension`

`fleet-pi-extension` owns:

- Pi lifecycle registration
- command registration
- keybind registration
- tool registration
- provider registration/stream glue and non-provider session handling
- settings/keybind/log/HUD bridges
- Pi overlays, widgets, editor/footer rendering
- compatibility adapters and push delivery seams

`fleet-pi-extension` must not become a new home for Fleet domain business logic.

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

- `packages/fleet-pi-extension/src/fleet/`
- `packages/fleet-pi-extension/src/grand-fleet/`
- `packages/fleet-pi-extension/src/metaphor/`
- `packages/fleet-pi-extension/src/core/`
- `packages/fleet-pi-extension/src/boot/`
- `packages/fleet-pi-extension/src/experimental-wiki/`

Agents must not use those historical paths as permission to reintroduce domain-first architecture inside `fleet-pi-extension`.

## 5. Allowed Dependency Direction

The intended dependency direction is:

```text
fleet-pi-extension capability buckets
  -> fleet-core public APIs
  -> Pi runtime / TUI / host facilities
```

Forbidden patterns:

- `fleet-core` importing Pi packages
- `fleet-pi-extension` deep-importing `fleet-core/src/**`
- new pure domain logic landing under `fleet-pi-extension/src/fleet/**`
- new Pi registration code landing inside `fleet-core`

## 6. Operational Guidance For Agents

When editing or reviewing this repo:

1. Ask first whether the behavior is pure Fleet domain logic or Pi host integration.
2. Put pure logic in `fleet-core`.
3. Put Pi lifecycle/registration/rendering in the appropriate capability bucket.
4. If a legacy module mixes both, split by ownership instead of preserving the old directory boundary.
5. Keep documentation and code organization aligned with the active `packages/fleet-pi-extension/src/<bucket>/` layout.

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
- avoid stating or implying that Pi capability buckets are scheduled to move out of `packages/fleet-pi-extension/src/`
