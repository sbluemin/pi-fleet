# tui

Owns all `@mariozechner/pi-tui` rendering for `pi-fleet-extension`.

## Scope

- HUD, Agent Panel, Streaming Widget, overlays, ACP shell UI, welcome surfaces, and Pi-facing renderers
- `hud-lifecycle.ts` — HUD lifecycle registration, including Status Bar and Editor mounting plus HUD render invalidation
- `agent-panel/streaming-sink.ts` — Agent Panel streaming sink integration, translating Fleet stream events into Agent Panel run state and column updates
- `thinking-timer.ts` — Owns thinking timer state and TUI overlay rendering logic

## Rules

- Rendering, widget placement, and overlay lifecycle belong here.
- HUD Status Bar / Editor lifecycle code belongs here even when it registers `pi.on(...)` listeners.
- Pure render-state derivation can live in `fleet-core`, but Pi component mounting stays here.
- Keep physical layout expectations explicit: this bucket lives under `src/tui/`.
