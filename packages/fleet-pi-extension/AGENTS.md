# fleet-pi-extension Doctrine

`packages/fleet-pi-extension` is the Pi capability package for Fleet. It owns Pi runtime wiring, capability-bucket entry points, TUI mounting, lifecycle listeners, config/keybind bridges, provider registration, and compatibility adapters while consuming `@sbluemin/fleet-core` through public exports only.

## Wave 12 Migration Status

- The **logical architecture is already the target architecture**:
  - `fleet-core` owns Fleet domain logic.
  - `fleet-pi-extension` owns Pi capability buckets.
- The **physical layout is still intermediate**:
  - capability buckets currently live under `packages/fleet-pi-extension/src/<bucket>/`
  - legacy domain folders under `src/` have been removed; do not reintroduce `src/fleet/**`, `src/grand-fleet/**`, `src/metaphor/**`, `src/core/**`, `src/boot/**`, or `src/experimental-wiki/**`
- **Wave 14 has not happened yet**. Do not claim that the package root already replaced `src/`.
- The final physical shape will move capability buckets to `packages/fleet-pi-extension/<bucket>/...` and remove `src/` in Wave 14.

## Capability Buckets

- `src/lifecycle/` — owns `pi.on(...)` listeners and event sequencing
- `src/commands/` — owns `pi.registerCommand(...)` wiring
- `src/keybinds/` — owns `pi.registerShortcut(...)` wiring
- `src/tools/` — owns `pi.registerTool(...)` and Pi-side renderer registration
- `src/tui/` — owns all `@mariozechner/pi-tui` rendering and overlays
- `src/session-bridge/` — owns Pi session/provider lifecycle glue
- `src/config-bridge/` — owns settings/keybind/log/HUD/provider-guard bridges
- `src/adapters/` — owns Pi-bound adapters over `fleet-core` ports and public APIs
- `src/compat/` — owns compatibility seams, including the sole `@mariozechner/pi-ai` bridge
- `src/diagnostics/` — owns optional diagnostics-only Pi extension surfaces

## Must Own

- `ExtensionAPI`, `ExtensionContext`, `pi.on(...)`, `pi.registerTool(...)`, `pi.registerCommand(...)`, `pi.registerShortcut(...)`, `pi.registerProvider(...)`, and `pi.sendMessage(...)`
- Pi widget/editor/footer/overlay rendering
- Pi-specific lifecycle coordination and active-run-safe wrappers
- Adapter implementations that bind `fleet-core` ports to Pi facilities

## Must Not Own

- New Fleet domain business logic that can live in `fleet-core`
- New deep domain trees under legacy homes like `src/fleet/**`, `src/grand-fleet/**`, or `src/metaphor/**`
- Deep imports from `@sbluemin/fleet-core/src/**` or `@sbluemin/fleet-core/internal/**`
- Additional `@mariozechner/pi-ai` imports outside `src/compat/pi-ai-bridge.ts`

## Import Boundaries

- Consume `@sbluemin/fleet-core` only through documented public root or subpath exports.
- Pi capability buckets may depend on each other when their responsibilities require it, but keep ownership clear: registration belongs to the owning bucket.
- Historical legacy homes under `src/` are already removed. Do not use their old paths as ownership signals or recreate them as transitional homes.

## Migration Guardrails

- Do not reintroduce Pi dependencies into `fleet-core`.
- Do not reintroduce domain-first architecture inside `fleet-pi-extension`.
- Do not create new code under removed legacy homes such as `src/fleet/**`, `src/grand-fleet/**`, `src/metaphor/**`, `src/core/**`, `src/boot/**`, or `src/experimental-wiki/**`.
- New Pi registration code should land in the appropriate capability bucket first.
- Wave 13 test relocation is separate and may still be in flight; documentation here must not depend on its completion.

## Compatibility Rules

- Preserve slash command names and existing `globalThis` compatibility keys.
- Preserve custom message delivery semantics for carrier completion pushes.
- When a module mixes Pi wiring with pure logic, keep the Pi half here and move the pure half to `fleet-core`.
