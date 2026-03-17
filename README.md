# pi-fleet

A multi-LLM orchestration kit for [pi-coding-agent](https://github.com/badlogic/pi-mono). Operate Claude Code, Codex CLI, and Gemini CLI through a single unified interface — using native CLIs directly, no API wrapping or proxying.

## Extensions

### Core Extensions

| Extension | Description |
|-----------|-------------|
| `unified-agent-direct` | Direct mode — switch between 4 agent panels via `Alt+1~4` |
| `unified-agent-tools` | Register `claude`, `codex`, `gemini` as individual pi tools with streaming widget |
| `hud-editor` | Custom status bar editor + footer |
| `hud-welcome` | Welcome overlay on session start |
| `utils-improve-prompt` | Meta-prompting via `Alt+Shift+M` |
| `utils-summarize` | Auto one-line session summary |

### Shared Libraries

| Library | Description | Used by |
|---------|-------------|---------|
| `hud-core` | Status bar rendering engine (segments, layout, colors, themes) | `hud-editor`, `hud-welcome` |
| `unified-agent-core` | Shared agent logic (client pool, executor, session map) | `unified-agent-direct`, `unified-agent-tools` |

## Setup

### 1. Clone

```bash
git clone https://github.com/sbluemin/pi-fleet.git ~/workspace/pi-fleet
```

### 2. Install dependencies

```bash
cd ~/workspace/pi-fleet/extensions/unified-agent-core
npm install
```

### 3. Register extensions in pi settings

Add the `extensions` field to your pi settings file.

**Global** (`~/.pi/agent/settings.json`):

```json
{
  "extensions": ["~/workspace/pi-fleet/extensions"]
}
```

**Or project-local** (`.pi/settings.json` in your project root):

```json
{
  "extensions": ["~/workspace/pi-fleet/extensions"]
}
```

### 4. Verify

Launch `pi` and run `/reload` — all extensions should load automatically.

## Requirements

- [pi-coding-agent](https://github.com/badlogic/pi-mono) installed globally
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

## License

MIT
