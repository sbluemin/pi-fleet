# PI Development Reference Guide

This guide explains how PI-facing Fleet development is organized during the capability-flattening migration.

## 1. Architectural Split

Fleet development now follows a hard split:

- `packages/fleet-core` — Pi-agnostic Fleet product core
- `packages/fleet-pi-extension` — Pi capability package

Use this split as the first decision point for every change.

## 2. Migration Stage

The codebase is in an intermediate stage:

- logical ownership already follows the final direction
- physical layout has **not** reached the final Wave 14 shape
- `packages/fleet-pi-extension/src/` still exists today
- capability buckets currently live under `packages/fleet-pi-extension/src/<bucket>/`

Do not document or implement as if the package-root bucket layout already exists.

## 3. Where New Work Goes

### 3.1 `packages/fleet-core`

Put code here when it is:

- pure orchestration or domain logic
- prompt composition
- state/store logic that does not require Pi runtime objects
- runtime contracts, ports, pure controllers, or public APIs

Do not put Pi registration or TUI mounting here.

### 3.2 `packages/fleet-pi-extension`

Put code here when it requires:

- `ExtensionContext` or `ExtensionAPI`
- `pi.on(...)`
- `pi.registerCommand(...)`
- `pi.registerShortcut(...)`
- `pi.registerTool(...)`
- `pi.registerProvider(...)`
- `pi.sendMessage(...)`
- `@mariozechner/pi-tui`

## 4. Capability Bucket Map

Current intermediate buckets:

| Bucket | Responsibility |
|--------|----------------|
| `src/lifecycle/` | PI lifecycle listeners and event sequencing |
| `src/commands/` | Slash command registration |
| `src/keybinds/` | Shortcut registration |
| `src/tools/` | Tool registration and custom message/render wiring |
| `src/tui/` | Editor, footer, widgets, overlays, panel, shell, welcome |
| `src/session-bridge/` | Session/provider glue and active-run-safe wrappers |
| `src/config-bridge/` | Settings/keybind/log/HUD/provider-guard bridge code |
| `src/adapters/` | Pi-bound adapters over `fleet-core` ports |
| `src/compat/` | Compatibility-only seams |

## 5. Removed Legacy Directory Guidance

The following legacy domain directories under `packages/fleet-pi-extension/src/` are already removed and must not be reintroduced:

- `src/fleet/`
- `src/grand-fleet/`
- `src/metaphor/`
- `src/core/`
- `src/boot/`
- `src/experimental-wiki/`

Do not treat historical paths such as `src/metaphor/`, `src/fleet/admiral/`, or `src/fleet/shipyard/carrier_jobs/` as present-day ownership signals. Their former existence does not change current ownership: Fleet domain logic belongs in `fleet-core`, and Pi host wiring belongs in the active capability buckets under `src/`.

When migrating or restoring behavior that once lived under those paths:

1. move pure/domain code toward `fleet-core`
2. move Pi registration/rendering code toward the correct capability bucket
3. do not recreate the deleted legacy directory as a shim

## 6. Import Rules

- `fleet-pi-extension` must consume `fleet-core` through public exports only.
- Do not deep-import `@sbluemin/fleet-core/src/**` or `@sbluemin/fleet-core/internal/**`.
- `fleet-core` must not import Pi packages.
- `@mariozechner/pi-ai` imports stay confined to `packages/fleet-pi-extension/src/compat/pi-ai-bridge.ts`.

## 7. PI Runtime Rules

- Background work must not capture stale Pi `ExtensionContext`.
- Detached-job completion delivery remains a Pi-side responsibility.
- Tool registration, custom renderer registration, and push-message wiring remain Pi capability concerns even when the underlying job logic lives in `fleet-core`.

## 8. Final Shape Reminder

Wave 14 is the physical cleanup wave:

- capability buckets move from `packages/fleet-pi-extension/src/<bucket>/...`
  to `packages/fleet-pi-extension/<bucket>/...`
- `packages/fleet-pi-extension/index.ts` becomes the package-root entry
- `packages/fleet-pi-extension/src/` is removed

That final shape is **not** the current state. Any documentation or review must say so explicitly.
