# shell

Owns host shell surfaces and aggregate UI management for `pi-fleet-extension`.

## Scope

- HUD, welcome surfaces, shared overlays, ACP shell UI, and host-facing shortcut registration
- `hud/` — HUD lifecycle and mounting (Status Bar, Editor overlays)
- `overlays/` — shared TUI overlays consumed by various domains
- `render/` — shared Pi-facing render utilities and component factory
- `thinking-timer.ts` — owns thinking timer state and TUI overlay rendering
- `keybinds/` — central Pi shortcut bridge (mirrors `shell/` shortcut intent)

## Rules

- Host shell rendering, widget placement, and aggregate overlay lifecycle belong here.
- HUD Status Bar / Editor lifecycle code belongs here; it bridges `fleet-core` state to Pi UI.
- Central Pi keybind registration belongs here, mapping host shortcuts to domain actions.
- **Flat Domain Rule**: Do not use `src/shell/` as a catch-all for registration logic. Domain-specific registration belongs in `agent/`, `grand-fleet/`, or `fleet-wiki/`.
- Legacy "Capability Buckets" nested under `shell/` (like `commands/`, `session/`) are being phased out; move logic to the top-level domain adapters.
- Pure render-state derivation lives in `fleet-core`, but Pi component mounting and host placement stay here.
