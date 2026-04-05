# Extensions Core

Infrastructure extensions for pi-fleet. Each provides a core UI or system feature loaded alongside other extension directories.

## Shared Config Files

| File | Description |
|------|-------------|
| `settings.json` | Default settings values shared across infra extensions |
| `keybindings.default.json` | Default keybinding definitions |

## Extensions

| Extension | Role |
|-----------|------|
| `agent/` | Core agent infrastructure — executor, client-pool, runtime, session-map, model-config, service-status |
| `hud/` | Editor + Status Bar (Private rendering engine) |
| `shell/` | Interactive shell session inside pi |
| `keybind/` | Centralized keybinding management + overlay (Alt+.) |
| `settings/` | Centralized settings API + overlay popup (Alt+/) |
| `welcome/` | Welcome overlay displayed on session start |

## Core Rules (hud)

- **HUD is a private extension**: Other extensions MUST NOT import from `extensions/core/hud/`. It does not provide a public API.
- **Status Bar Integration**: HUD uses `setupStatusBar()` to initialize the status bar and manage widget placements.
- **Widget Placement**:
  - `hud-status-bar`: Primary status information (belowEditor, left align).
  - `hud-notification`: Temporary notifications and status messages (belowEditor).
- HUD is no longer responsible for rendering fleet carrier-specific colors or banners.

## Slash Command Domain Assignment

| Extension | Domain | Rationale |
|-----------|--------|-----------|
| `hud/` | `hud` | HUD / editor display features |
