# keybinds

Owns `pi.registerShortcut(...)` wiring for `pi-fleet-extension`.

## Scope

- Global Fleet shortcuts and bucket-level keybind registration entry points
- Wiring from shortcuts into TUI overlays, commands, or session-owned Pi features

## Rules

- Keybind registration belongs here even when the triggered behavior lives elsewhere.
- Keep physical layout expectations explicit: this bucket lives under `src/keybinds/`.
