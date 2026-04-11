# pi-fleet

A multi-LLM orchestration kit for [pi-coding-agent](https://github.com/badlogic/pi-mono). Operate Claude Code, Codex CLI, and Gemini CLI through a single unified interface — using native CLIs directly, no API wrapping or proxying.

## Naval Fleet Metaphor

This project treats individual LLM agents as **Carriers** within a **Fleet**.

- **Fleet Admiral**: The **User** who wields the tool and sets the ultimate strategy.
- **Admiral**: The **Main Orchestrator (PI's LLM)** that plans operations and delegates to the fleet.
- **Carrier**: An **Execution Instance** of a CLI tool (Claude, Codex, Gemini). Each carrier has its own persona, specialization, and isolated session.

## Extensions

### Infrastructure (`extensions/core/`)

`extensions/core/` is a single infrastructure extension. The root `extensions/core/index.ts` wires the internal modules below.

| Module | Domain | Description |
|--------|--------|-------------|
| `agent/` | `agent` | Core agent infrastructure — executor, client-pool, runtime, session-map, model-config, service-status |
| `hud/` | `hud` | **Heads-Up Display** — Integrated Editor + Status Bar + Footer rendering engine |
| `keybind/` | `keybind` | Centralized keybinding management + overlay (`Alt+.`) |
| `settings/` | `settings` | Centralized settings API + overlay popup (`Alt+/`) |
| `welcome/` | `welcome` | Welcome overlay displayed on session start |
| `log/` | `log` | Reusable logging — file log + footer display + globalThis API for other extensions |
| `shell/` | `shell` | Interactive shell session (xterm.js + node-pty) inside pi |
| `improve-prompt/` | `prompt` | Meta-prompting via `Alt+M`, reasoning level cycle via `Alt+R` |
| `summarize/` | `summary` | Auto one-line session summary displayed in Status Bar |
| `thinking-timer/` | `timer` | Inline elapsed-time display for Thinking blocks in Messages zone |
| `provider-guard/` | `guard` | Provider allowlist guard and blocked-model fallback |
| `acp-provider/` | `acp` | ACP-native provider that integrates Claude, Codex, and Gemini CLI backends |

### Admiral Policy (`extensions/admiral/`)

| Extension | Domain | Description |
|-----------|--------|-------------|
| `admiral/` | `admiral` | **Host-Agent Prompt Policy** — Admiral system prompt injection, worldview toggle, and settings section ownership |

### Agent Framework (`extensions/fleet/`)

| Extension | Domain | Description |
|-----------|--------|-------------|
| `fleet/` | `agent` | **Core Orchestrator** — Carrier framework SDK, Agent Panel (streaming UI), unified execution pipeline, model selection, session/model persistence |

### Carriers (`extensions/carriers/`)

Independent carrier registrations defining unique personas for each CLI instance. Each carrier occupies an independent **Slot** for inline navigation and side-by-side execution.

| Carrier | CLI | Role | Slot |
|---------|-----|------|------|
| **Genesis** | Codex | CVN-01 Chief Engineer (Implementation, integration, code delivery & clean code) | #1 |
| **Athena** | Claude | CVN-02 Strategic Planning Officer (Requirements clarification, PRD realization & structured work planning) | #2 |
| **Oracle**  | Claude | CVN-09 Strategic Technical Advisor (Read-only technical path decisions & architectural guidance) | #3 |
| **Sentinel**| Codex  | CVN-04 The Inquisitor / QA & Security Lead (Code review, defect detection, quality audits & security) | #4 |
| **Vanguard**| Codex | CVN-06 Scout Specialist (Reconnaissance & web research) | #5 |
| **Echelon** | Gemini | CVN-07 Chief Intelligence Officer (Deep repository scanning & GitHub intelligence) | #6 |
| **Chronicle**| Gemini | CVN-08 Chief Knowledge Officer (Documentation, change-impact reporting & technical writing) | #7 |

## Task Force

**Task Force** runs a single carrier's persona simultaneously across all three CLI backends (Claude, Codex, Gemini) and returns a consolidated cross-validation comparison.

Use it when you need to compare approaches, detect model-specific blind spots, or build consensus across backends. Results are returned as `[Claude] (status)`, `[Codex] (status)`, `[Gemini] (status)` — each backend runs independently, so a failure in one does not abort the others.

### When to use
- Comparing solution approaches across models
- Catching blind spots a single backend might miss
- Building multi-model consensus on architecture or analysis decisions

### When NOT to use
- Routine single-backend tasks (use `carrier_sortie` instead)
- When execution speed is critical
- As a substitute for launching multiple different carriers in parallel

### Configuration

Task Force requires per-carrier model configuration for each CLI backend before use.

1. Open the Fleet Status Overlay: `Alt+O`
2. Select a carrier and press `T` to open Task Force model config
3. Configure the model/reasoning for each of the three backends (Claude, Codex, Gemini)

Once all three backends are configured for a carrier, it becomes available as a `carrier_taskforce` parameter.

## Keybindings

### Admiral Protocol
| Key | Action |
|-----|--------|
| `Alt+1` | Switch to Fleet Action Protocol |
| `Alt+2~9` | Switch to additional protocols (future) |

### Carrier Slots & Navigation
| Key | Action |
|-----|--------|
| `Alt+H` / `L` | Navigate to Previous / Next Carrier slot |
| `Ctrl+Enter` | Toggle detail view for the selected carrier |

### Panel & Fleet Control
| Key | Action |
|-----|--------|
| `Alt+P` | Toggle Agent Panel (Show/Hide) |
| `Alt+J` | Grow Agent Panel height |
| `Alt+K` | Shrink Agent Panel height |
| `Alt+S` | Stash / restore the current editor content |
| `Alt+O` | Fleet Status & Model Config Overlay |
| `Alt+T` | Open Carrier Native Terminal Bridge (PTY) |
| `Alt+X` | Cancel execution of the active Carrier |
| `Alt+Shift+M` | Change Model and Reasoning settings for the active Carrier |

### Prompting Tools
| Key | Action |
|-----|--------|
| `Alt+M` | Improve current input via Meta-prompting |
| `Alt+R` | Cycle Reasoning Level (Off → Low → Medium → High) |
| `Alt+.` | Keybinding help overlay |
| `Alt+/` | Settings overlay |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/fleet:agent:models` | Configure model selection for each registered carrier (slot order) |
| `/fleet:agent:status` | Instantly refresh the connection status of all CLI services |
| `/fleet:admiral:worldview` | Toggle Naval Fleet "Persona" prompts on/off |
| `/fleet:hud:editor` | Configure HUD editor display status (toggle, preset) |
| `/fleet:prompt:settings` | Meta-prompt model and reasoning level settings |
| `/fleet:summary:settings` | Auto-summary model and max-length settings |
| `/fleet:log:toggle` | Toggle logging on/off |
| `/fleet:log:settings` | Detailed logging settings (file, footer, level, clear) |

## Packages

| Package | Description |
|---------|-------------|
| `packages/unified-agent/` | **Unified SDK** — TypeScript SDK that unifies Codex CLI, Claude Code, and Gemini CLI over the ACP protocol. Provides both a CLI binary and a programmatic SDK with event-based streaming. |

## Setup

See [SETUP.md](SETUP.md) for step-by-step instructions.

### Quick Start (with LLM Agent)

Copy the prompt below and paste it into your LLM agent (Claude Code, Codex CLI, Gemini CLI, etc.):

> Install and configure pi-fleet by following the instructions here:
> `gh api repos/sbluemin/pi-fleet/contents/SETUP.md -H "Accept: application/vnd.github.raw+json"`

## License

MIT
