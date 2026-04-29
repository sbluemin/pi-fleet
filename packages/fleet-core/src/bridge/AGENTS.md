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

## Render Subpath

The **`@sbluemin/fleet-core/bridge/render`** subpath is strictly for **View-Models**. It provides:

- Pure data interfaces (`PanelJobViewModel`, `PanelTrackViewModel`).
- Deterministic builders (`buildPanelViewModel`) that transform bridge state into render-ready snapshots.

Host adapters (like Pi) must consume these view-models to drive their native UI components. The bridge does not know how to mount or render these models.

## Public Surface

Keep consumers on public package exports only:

- `@sbluemin/fleet-core/bridge`
- `@sbluemin/fleet-core/bridge/streaming`
- `@sbluemin/fleet-core/bridge/panel`
- `@sbluemin/fleet-core/bridge/render` (View-Model only)
- `@sbluemin/fleet-core/bridge/carrier-ui`

Do not add `@sbluemin/fleet-core/src/**` or `@sbluemin/fleet-core/internal/**` consumers.
