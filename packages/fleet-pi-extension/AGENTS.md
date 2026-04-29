# fleet-pi-extension Doctrine

`packages/fleet-pi-extension` is the Pi capability package for Fleet. It owns Pi runtime wiring, capability-bucket entry points, TUI mounting, lifecycle listeners, bindings, provider registration, and compatibility adapters while consuming `@sbluemin/fleet-core` through public exports only.

## Current Architecture Status

- The **logical architecture is already the target architecture**:
  - `fleet-core` owns Fleet domain logic.
  - `fleet-pi-extension` owns Pi capability buckets.
- The **physical layout keeps active Pi buckets under `src/`**:
  - capability buckets currently live under `packages/fleet-pi-extension/src/<bucket>/`
  - legacy domain folders under `src/` have been removed; do not reintroduce `src/fleet/**`, `src/grand-fleet/**`, `src/metaphor/**`, `src/core/**`, `src/boot/**`, or `src/experimental-wiki/**`
- Do not claim or imply that Pi capability buckets are scheduled to move out of `src/`.

## Capability Buckets

- `src/bindings/` — owns fleet-core public API to Pi wrapper/facade/adapter bridges
  - `src/bindings/runtime/` — owns `pi.on(...)` listeners and host event sequencing (formerly lifecycle)
  - `src/bindings/compat/` — owns compatibility seams, including the sole `@mariozechner/pi-ai` bridge (formerly compat)
  - includes config/keybind/log/HUD/provider-guard/carrier/admiral/jobs bindings
- `src/commands/` — owns `pi.registerCommand(...)` wiring
- `src/keybinds/` — owns `pi.registerShortcut(...)` wiring
- `src/tools/` — owns `pi.registerTool(...)` and Pi-side renderer registration
- `src/tui/` — owns all `@mariozechner/pi-tui` rendering, overlays, and host shell UI
- `src/provider/` — owns Pi provider registration, stream wiring, and provider lifecycle glue
- `src/session/` — owns non-provider Pi session features and active-run-safe wrappers

## Must Own

- `ExtensionAPI`, `ExtensionContext`, `pi.on(...)`, `pi.registerTool(...)`, `pi.registerCommand(...)`, `pi.registerShortcut(...)`, `pi.registerProvider(...)`, and `pi.sendMessage(...)`
- Pi widget/editor/footer/overlay rendering
- Pi-specific lifecycle coordination and active-run-safe wrappers
- Pi tool registration loops that consume `fleet-core` tool specs and call `pi.registerTool(...)`
- Binding implementations that connect `fleet-core` public APIs and ports to Pi facilities

## Must Not Own

- New Fleet domain business logic that can live in `fleet-core`
- New deep domain trees under legacy homes like `src/fleet/**`, `src/grand-fleet/**`, or `src/metaphor/**`
- Deep imports from `@sbluemin/fleet-core/src/**` or `@sbluemin/fleet-core/internal/**`
- Additional `@mariozechner/pi-ai` imports outside `src/bindings/compat/pi-ai-bridge.ts`

## Import Boundaries

- Consume `@sbluemin/fleet-core` only through documented public root or subpath exports.
- Pi capability buckets may depend on each other when their responsibilities require it, but keep ownership clear: registration belongs to the owning bucket.
- Historical legacy homes under `src/` are already removed. Do not use their old paths as ownership signals or recreate them as transitional homes.
- Tool definitions should come from `fleet-core` registries where possible; Pi files add only host adapters, renderers, push delivery, and lifecycle gates.

## Migration Guardrails

- Do not reintroduce Pi dependencies into `fleet-core`.
- Do not reintroduce domain-first architecture inside `fleet-pi-extension`.
- Do not create new code under removed legacy homes such as `src/fleet/**`, `src/grand-fleet/**`, `src/metaphor/**`, `src/core/**`, `src/boot/**`, or `src/experimental-wiki/**`.
- New Pi registration code should land in the appropriate capability bucket first.

## Compatibility Rules

- Preserve slash command names and existing `globalThis` compatibility keys.
- Preserve custom message delivery semantics for carrier completion pushes.
- When a module mixes Pi wiring with pure logic, keep the Pi half here and move the pure half to `fleet-core`.
