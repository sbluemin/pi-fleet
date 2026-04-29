# tui

Owns all `@mariozechner/pi-tui` rendering for `fleet-pi-extension`.

## Scope

- HUD, Agent Panel, Streaming Widget, overlays, ACP shell UI, welcome surfaces, and Pi-facing renderers

## Rules

- Rendering, widget placement, and overlay lifecycle belong here.
- Pure render-state derivation can live in `fleet-core`, but Pi component mounting stays here.
- Keep physical layout expectations explicit: this bucket lives under `src/tui/`.
