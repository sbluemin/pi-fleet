# keybinds

Owns `pi.registerShortcut(...)` wiring for `fleet-pi-extension`.

## Scope

- Global Fleet shortcuts and bucket-level keybind registration entry points
- Wiring from shortcuts into TUI overlays, commands, or session bridges

## Rules

- Keybind registration belongs here even when the triggered behavior lives elsewhere.
- Keep physical layout expectations explicit: this is still `src/keybinds/` until Wave 14.
