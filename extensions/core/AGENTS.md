# Extensions Core

Infrastructure extension for pi-fleet. `core/index.ts` is the only extension entry point; each subdirectory below it is an internal module or shared library.

## Shared Config Files

| File | Description |
|------|-------------|
| `settings.json` | Default settings values shared across infra extensions |
| `keybindings.default.json` | Default keybinding definitions |

## Modules

| Module | Role |
|--------|------|
| `index.ts` | Root entry point — registers all core modules in deterministic order |
| `agent/` | Core agent infrastructure — executor, client-pool, runtime, session-map, model-config, service-status |
| `hud/` | Editor + Status Bar (Private rendering engine) |
| `shell/` | Interactive shell session inside pi |
| `keybind/` | Centralized keybinding management + overlay (Alt+.) |
| `settings/` | Centralized settings API + overlay popup (Alt+/) |
| `welcome/` | Welcome overlay displayed on session start |
| `log/` | Reusable logging — file log + footer display + globalThis API for other extensions |
| `improve-prompt/` | Meta-prompting and reasoning level controls |
| `summarize/` | Auto one-line session summary widget |
| `thinking-timer/` | Inline elapsed-time display for Thinking blocks |
| `provider-guard/` | Always-on guard — disables specified built-in providers and auto-fallbacks away from blocked placeholder models on session_start / model_select |
| `acp-provider/` | ACP-based native provider — integrates CLI backends (Claude, Codex, Gemini) via ACP protocol + in-process MCP server |

## Wiring Rule

- `core/index.ts` is the only auto-loaded extension entry point.
- Each functional module below `core/` exposes `register.ts` for root wiring.
- `agent/` remains a shared library and must not become an extension entry point.

## Core Rules (hud)

- **HUD는 private extension**: 외부 확장은 `extensions/core/hud/`의 내부 파일을 직접 import할 수 없다.
- **public 인터페이스**: `border-bridge.ts`의 globalThis 키 + Footer Bridge의 globalThis 키를 통한 간접 통신만 허용. 자세한 키 목록은 `hud/AGENTS.md` 참조.
- **Status Bar Integration**: HUD uses `setupStatusBar()` to initialize the status bar and manage widget placements.
- **Widget Placement**:
  - `hud-status-bar`: Primary status information (belowEditor, center align).
  - `hud-notification`: Temporary notifications and status messages (belowEditor, center align).
- HUD is no longer responsible for rendering fleet carrier-specific colors or banners.

## Slash Command Domain Assignment

| Extension | Domain | Rationale |
|-----------|--------|-----------|
| `log/` | `log` | Logging features |
| `hud/` | `hud` | HUD / editor display features |
| `keybind/` | `keybind` | Keybinding management |
| `settings/` | `settings` | Settings management |
| `welcome/` | `welcome` | Welcome message |
| `improve-prompt/` | `prompt` | Prompt improvement features |
| `summarize/` | `summary` | Session summary features |
| `thinking-timer/` | `timer` | Thinking block timer features |
| `provider-guard/` | `guard` | Provider guard features |
| `acp-provider/` | `acp` | ACP provider features |
