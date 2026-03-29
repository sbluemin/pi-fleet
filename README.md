# pi-fleet

A multi-LLM orchestration kit for [pi-coding-agent](https://github.com/badlogic/pi-mono). Operate Claude Code, Codex CLI, and Gemini CLI through a single unified interface — using native CLIs directly, no API wrapping or proxying.

## Extensions

### Infrastructure (`extensions/dock/`)

| Extension | Description |
|-----------|-------------|
| `hud/` | Custom editor + status bar + footer with integrated rendering engine |
| `keybind/` | Centralized keybinding management + overlay (`Alt+.`) |
| `settings/` | Centralized settings API + overlay popup (`Alt+/`) |
| `welcome/` | Welcome overlay displayed on session start |
| `shell/` | Interactive shell session inside pi |

### Core (`extensions/fleet/`)

| Extension | Description |
|-----------|-------------|
| `unified-agent-direct/` | Direct mode — `Alt+1/2/3` exclusive view, `Alt+P` panel toggle + individual agent tools, client pool, executor, session map, model config |

### Utility (`extensions/tender/`)

| Extension | Description |
|-----------|-------------|
| `improve-prompt/` | Meta-prompting via `Alt+M`, reasoning level cycle via `Alt+R` |
| `summarize/` | Auto one-line session summary |
| `thinking-timer/` | Inline elapsed-time display next to collapsed Thinking blocks |

### Archived specs (`.spsec/`)

| Directory | Description |
|-----------|-------------|
| `fleet-orchestration/` | Archived planning/spec materials for multi-agent orchestration |
| `fleet-task/` | Archived task system specification |
| `fleet-unit-explore/` | Archived exploration extension notes |
| `fleet-unit-librarian/` | Archived librarian extension notes |

## Packages

| Package | Description |
|---------|-------------|
| `packages/unified-agent/` | TypeScript SDK — unifies Codex CLI, Claude Code, and Gemini CLI under a single interface over the ACP protocol. Provides both a CLI binary and a programmatic SDK with event-based streaming. |

## Setup

### With LLM Agent (Recommended)

Copy the prompt below and paste it into your LLM agent (Claude Code, Codex CLI, Gemini CLI, etc.):

> Install and configure pi-fleet by following the instructions here:
> `gh api repos/sbluemin/pi-fleet/contents/SETUP.md -H "Accept: application/vnd.github.raw+json"`

Or pipe the guide directly:

```bash
gh api repos/sbluemin/pi-fleet/contents/SETUP.md -H "Accept: application/vnd.github.raw+json"
```

### Manual

See [SETUP.md](SETUP.md) for step-by-step instructions.

## License

MIT
