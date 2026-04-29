# PI Development Reference Guide

This guide explains how PI-facing Fleet development is organized during the capability-flattening migration.

## 1. Architectural Split

Fleet development now follows a hard split:

- `packages/fleet-core` — Pi-agnostic Fleet product core
- `packages/fleet-core/src/gfleet` — internalized Grand Fleet domain
- `packages/pi-fleet-extension` — Pi capability package

Use this split as the first decision point for every change.

## 2. Migration Stage

The codebase is in a capability-flattening stage:

- logical ownership already follows the final direction
- `packages/pi-fleet-extension/src/` remains the active physical home for Pi capability buckets
- capability buckets currently live under `packages/pi-fleet-extension/src/<bucket>/`

Do not document or implement relocation of these buckets out of `src/`.

## 3. Where New Work Goes

### 3.1 `packages/fleet-core`

Put code here when it is:

- pure orchestration or domain logic
- prompt composition
- state/store logic that does not require Pi runtime objects
- runtime contracts, ports, pure controllers, or public APIs

Do not put Pi registration or TUI mounting here.

### 3.2 `packages/fleet-core/src/gfleet`

Put code here when it is:

- Grand Fleet prompt composition or reporter logic
- Grand Fleet IPC protocol contracts
- Grand Fleet formation helpers exposed through `@sbluemin/fleet-core/gfleet/formation`
- Grand Fleet shared types, tool specs, status source logic, or text sanitization

Keep dependencies one-way: `fleet-core`.

### 3.3 `packages/pi-fleet-extension`

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

Current capability buckets:

| Bucket | Responsibility |
|--------|----------------|
| `src/bindings/runtime/` | PI lifecycle listeners and host event sequencing |
| `src/bindings/compat/` | Compatibility-only seams, including the pi-ai bridge |
| `src/bindings/` | Pi-bound wrappers/adapters over `fleet-core` ports (config, HUD, jobs, etc.) |
| `src/commands/` | Slash command registration |
| `src/keybinds/` | Shortcut registration |
| `src/tools/` | Tool registration and custom message/render wiring |
| `src/tui/` | Editor, footer, widgets, overlays, panel, shell, welcome |
| `src/provider/` | Provider registration, provider stream wiring, and provider lifecycle glue |
| `src/session/` | Non-provider Pi session features and active-run-safe wrappers |

## 5. Removed Legacy Directory Guidance

The following legacy domain directories under `packages/pi-fleet-extension/src/` are already removed and must not be reintroduced:

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

- `pi-fleet-extension` must consume `fleet-core` through public exports only.
- `pi-fleet-extension` must consume Grand Fleet surfaces through `@sbluemin/fleet-core/gfleet`, `@sbluemin/fleet-core/gfleet/ipc`, or `@sbluemin/fleet-core/gfleet/formation`.
- `pi-fleet-extension` may consume `@sbluemin/fleet-wiki` for experimental wiki adapters.
- Do not deep-import `@sbluemin/fleet-core/src/**` or `@sbluemin/fleet-core/internal/**`.
- Do not import Grand Fleet surfaces from the deprecated Fleet Core location.
- `fleet-core` must not import Pi packages.
- `fleet-core` must not split internal gfleet ownership back out into a separate package.
- `@mariozechner/pi-ai` imports stay confined to `packages/pi-fleet-extension/src/bindings/compat/pi-ai-bridge.ts`.

## 7. PI Runtime Rules

- Background work must not capture stale Pi `ExtensionContext`.
- Detached-job completion delivery remains a Pi-side responsibility.
- Tool registration, custom renderer registration, and push-message wiring remain Pi capability concerns even when the underlying job logic lives in `fleet-core`.

## 8. Physical Layout Reminder

`packages/pi-fleet-extension/src/` is the active physical home for Pi capability buckets. Any documentation or review must keep that layout explicit and avoid implying that these buckets are scheduled to move.
