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
| `provider-guard/` | Always-on guard — disables specified built-in providers and auto-fallbacks away from blocked placeholder models on session_start / model_select |

## Core Rules (hud)

- **HUD는 private extension**: 외부 확장은 `extensions/core/hud/`의 내부 파일을 직접 import할 수 없다.
- **유일한 public 인터페이스**: `border-bridge.ts` — globalThis `"__pi_hud_editor_border_color__"` 키를 통한 간접 통신만 허용.
- **Status Bar Integration**: HUD uses `setupStatusBar()` to initialize the status bar and manage widget placements.
- **Widget Placement**:
  - `hud-status-bar`: Primary status information (belowEditor, center align).
  - `hud-notification`: Temporary notifications and status messages (belowEditor, center align).
- HUD is no longer responsible for rendering fleet carrier-specific colors or banners.

## Slash Command Domain Assignment

| Extension | Domain | Rationale |
|-----------|--------|-----------|
| `hud/` | `hud` | HUD / editor display features |
