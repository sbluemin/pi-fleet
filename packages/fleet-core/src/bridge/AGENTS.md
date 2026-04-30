# bridge Doctrine

`packages/fleet-core/src/bridge` is the host-agnostic bridge layer for Fleet panel, streaming, carrier UI, and renderer-facing data contracts.

## Owns

- Plain TypeScript types and DTOs consumed by host adapters.
- Runtime-neutral state stores and compatibility keys.
- **`BridgeStateStorage` port** for injecting host-owned storage (defaults to `globalThis`).
- Event normalization and **pure View-Model builders** for host renderers.
- Controller classes whose host side effects are injected through interfaces or callbacks.

## Must Not Own

- `ExtensionContext`, `ExtensionAPI`, `pi.*`, Pi lifecycle hooks, command/tool/keybind/provider registration, or message push delivery.
- `@mariozechner/pi-tui`, `@mariozechner/pi-coding-agent`, or `@mariozechner/pi-ai` imports.
- ANSI, terminal, widget, overlay, editor, footer, or mounting implementation.
- Pi-side carrier completion push wiring, detached-job custom renderer registration, or provider stream glue.

## Compatibility Keys

The bridge state layer preserves these global compatibility keys by default:

- `__pi_stream_store__`
- `__pi_agent_panel_state__`

Adapters may replace storage through **`configureBridgeStateStorage(storage)`** for tests, isolated runtimes, or non-global hosts. When provided, the bridge will use the injected storage instead of `globalThis`.

## Subpaths

The bridge public surface is intentionally split by adapter-facing data concern:

- **`@sbluemin/fleet-core/bridge/run-stream`** owns per-run stream state, stream DTOs, and `BridgeStateStorage` injection.
- **`@sbluemin/fleet-core/bridge/carrier-panel`** owns carrier job/track state plus pure panel view-model builders.
- **`@sbluemin/fleet-core/bridge/carrier-control`** owns carrier control overlay DTOs and host-port-driven controller logic.

Host adapters (like Pi) consume these data models to drive native UI components. The bridge does not know how to mount or render them.

## Public Surface

Keep consumers on public package exports only:

- `@sbluemin/fleet-core/bridge/run-stream`
- `@sbluemin/fleet-core/bridge/carrier-panel`
- `@sbluemin/fleet-core/bridge/carrier-control`

Do not add `@sbluemin/fleet-core/src/**` or `@sbluemin/fleet-core/internal/**` consumers.
