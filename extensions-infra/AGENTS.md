# Extensions-Infra

Infrastructure extensions for pi-fleet. Each provides a core UI or system feature loaded alongside other extension directories.

## Shared Config Files

| File | Description |
|------|-------------|
| `settings.json` | Default settings values shared across infra extensions |
| `keybindings.default.json` | Default keybinding definitions |

## Extensions

| Extension | Role |
|-----------|------|
| `experimental/` | System-level toggles for experimental features (Alt+E) |
| `hud/` | Custom editor + status bar + footer (integrated rendering engine) |
| `interactive-shell/` | Interactive shell session inside pi |
| `keybind/` | Centralized keybinding management + overlay (Alt+.) |
| `settings/` | Centralized settings API + overlay popup (Alt+/) |
| `welcome/` | Welcome overlay displayed on session start |

## Slash Command Domain Assignment

| Extension | Domain | Rationale |
|-----------|--------|-----------|
| `hud/` | `hud` | HUD / editor display features |
| `experimental/` | `system` | System-level toggles and infra controls |
