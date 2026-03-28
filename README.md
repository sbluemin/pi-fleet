# pi-fleet

A multi-LLM orchestration kit for [pi-coding-agent](https://github.com/badlogic/pi-mono). Operate Claude Code, Codex CLI, and Gemini CLI through a single unified interface — using native CLIs directly, no API wrapping or proxying.

## Extensions

### Core Extensions

| Extension | Description |
|-----------|-------------|
| `unified-agent-direct` | Direct mode — `Alt+1/2/3` exclusive view, `Alt+0` tri-split view, `Alt+P` panel toggle + individual agent tools, client pool, executor, session map, model config |
| `infra-hud` | Custom status bar editor + footer (with integrated rendering engine) |
| `utils-welcome` | Welcome overlay on session start |
| `utils-thinking-timer` | Inline elapsed-time display next to collapsed Thinking blocks |
| `utils-improve-prompt` | Meta-prompting via `Alt+M`, reasoning level cycle via `Alt+R` |
| `utils-summarize` | Auto one-line session summary |

### Shared Libraries

| Library | Description | Used by |
|---------|-------------|---------|
| `infra-hud` (also extension) | Status bar rendering engine (segments, layout, colors, themes, git-status, icons, context builder) | `utils-welcome` |

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
