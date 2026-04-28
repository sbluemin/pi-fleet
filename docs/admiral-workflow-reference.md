# Admiral Workflow Reference

This document is the operational doctrine for Admiral and Carrier agents working inside this repository during the Fleet capability-flattening migration.

## 1. Current Architecture State

The migration target is already fixed:

- `packages/fleet-core` owns Fleet **domain logic**
- `packages/fleet-pi-extension` owns Pi **capability buckets**

The repository is still in an **intermediate physical state**:

- `packages/fleet-core` remains under `packages/fleet-core/src/`
- `packages/fleet-pi-extension` capability buckets still remain under `packages/fleet-pi-extension/src/<bucket>/`
- Wave 14 has **not** happened yet, so `packages/fleet-pi-extension/src/` still exists today

Agents must not confuse logical ownership with final physical layout. `packages/fleet-pi-extension/src/` still exists, but the old legacy domain folders under it have been removed and must not be recreated.

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
- provider/session glue
- settings/keybind/log/HUD bridges
- Pi overlays, widgets, editor/footer rendering
- compatibility adapters and push delivery seams

`fleet-pi-extension` must not become a new home for Fleet domain business logic.

## 3. Capability Buckets

During the intermediate stage, Pi ownership is expressed through these buckets:

- `src/lifecycle/` — `pi.on(...)` listeners and event sequencing
- `src/commands/` — slash command registration
- `src/keybinds/` — shortcut registration
- `src/tools/` — tool registration and Pi-side renderer/message wiring
- `src/tui/` — all Pi TUI rendering
- `src/session-bridge/` — provider/session lifecycle glue
- `src/config-bridge/` — settings/keybind/log/HUD/provider-guard bridges
- `src/adapters/` — Pi-bound adapters over `fleet-core`
- `src/compat/` — compatibility-only seams
- `src/diagnostics/` — optional diagnostics extension surfaces

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
5. Do not claim Wave 14 is complete until `packages/fleet-pi-extension/src/` is physically gone.

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
- separate **logical ownership now** from **physical shape later**
- mention that legacy domain folders have been removed and Wave 13 test relocation is complete when that context matters
- avoid stating or implying that Wave 14 `src/` removal is already complete
