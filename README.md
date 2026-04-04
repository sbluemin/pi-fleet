# pi-fleet

A multi-LLM orchestration kit for [pi-coding-agent](https://github.com/badlogic/pi-mono). Operate Claude Code, Codex CLI, and Gemini CLI through a single unified interface — using native CLIs directly, no API wrapping or proxying.

## Naval Fleet Metaphor

This project treats individual LLM agents as **Carriers** within a **Fleet**.

- **Fleet Admiral**: The **User** who wields the tool and sets the ultimate strategy.
- **Admiral**: The **Main Orchestrator (PI's LLM)** that plans operations and delegates to the fleet.
- **Carrier**: An **Execution Instance** of a CLI tool (Claude, Codex, Gemini). Each carrier has its own persona, specialization, and isolated session.

## Extensions

### Infrastructure (`extensions/core/`)

| Extension | Domain | Description |
|-----------|--------|-------------|
| `hud/` | `hud` | **Heads-Up Display** — Integrated Editor + Status Bar + Footer rendering engine |
| `keybind/` | `keybind` | Centralized keybinding management + overlay (`Alt+.`) |
| `settings/` | `settings` | Centralized settings API + overlay popup (`Alt+/`) |
| `welcome/` | `welcome` | Welcome overlay displayed on session start |
| `shell/` | `shell` | Interactive shell session (xterm.js + node-pty) inside pi |
| `improve-prompt/` | `prompt` | Meta-prompting via `Alt+M`, reasoning level cycle via `Alt+R` |
| `summarize/` | `summary` | Auto one-line session summary displayed in Status Bar |
| `thinking-timer/` | `timer` | Inline elapsed-time display for Thinking blocks in Messages zone |

### Agent Framework (`extensions/fleet/`)

| Extension | Domain | Description |
|-----------|--------|-------------|
| `fleet/` | `agent` | **Core Orchestrator** — Carrier framework SDK, Agent Panel (streaming UI), unified execution pipeline, model selection, session/model persistence |

### Carriers (`extensions/carriers/`)

Independent carrier registrations defining unique personas for each CLI instance. Each carrier occupies an independent **Slot** for inline navigation and side-by-side execution.

| Carrier | CLI | Role | Slot |
|---------|-----|------|------|
| **Genesis** | Claude | CVN-01 Chief Engineer (System design & core backend) | `Alt+1` |
| **Arbiter** | Claude | CVN-02 Chief Doctrine Officer (Standards & instruction conflict resolution) | `Alt+2` |
| **Crucible**| Codex  | CVN-03 Chief Forgemaster (Dead code removal & DRY refactoring) | `Alt+3` |
| **Sentinel**| Codex  | CVN-04 The Inquisitor (QA lead & hidden bug hunting) | `Alt+4` |
| **Raven**   | Codex  | CVN-05 Red Team Commander (Security auditing & penetration testing) | `Alt+5` |
| **Vanguard**| Gemini | CVN-06 Scout Specialist (Reconnaissance & web research) | `Alt+6` |
| **Echelon** | Gemini | CVN-07 Chief Intelligence Officer (Deep repository scanning & GitHub intelligence) | `Alt+7` |
| **Chronicle**| Gemini | CVN-08 Chief Knowledge Officer (Documentation & technical writing) | `Alt+8` |
| **Oracle**   | Claude | CVN-09 Strategic Technical Advisor (Read-only architectural guidance) | `Alt+9` |

## Keybindings

### Carrier Slots & Navigation
| Key | Action |
|-----|--------|
| `Alt+1` ~ `9` | Select specific Carrier slot |
| `Alt+H` / `L` | Navigate to Previous / Next Carrier slot |
| `Ctrl+Enter` | Enable **Exclusive Mode** for the selected carrier (direct communication) |

### Panel & Fleet Control
| Key | Action |
|-----|--------|
| `Alt+P` | Toggle Agent Panel (Show/Hide) |
| `Alt+O` | Fleet Status & Model Config Overlay |
| `Alt+T` | Open Carrier Native Terminal Bridge (PTY) |
| `Alt+X` | Cancel execution of the active Carrier |
| `Alt+Shift+M` | Change Model and Reasoning settings for the active Carrier |

### Prompting Tools
| Key | Action |
|-----|--------|
| `Alt+M` | Improve current input via Meta-prompting |
| `Alt+R` | Cycle Reasoning Level (None → Normal → Deep) |
| `Alt+.` | Keybinding help overlay |
| `Alt+/` | Settings overlay |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/fleet:agent:status` | Instantly refresh the connection status of all CLI services |
| `/fleet:agent:worldview` | Toggle Naval Fleet "Persona" prompts on/off |
| `/fleet:prompt:improve` | Meta-prompting to improve the current input (`Alt+M`) |
| `/fleet:prompt:reasoning` | Cycle reasoning levels (`Alt+R`) |
| `/fleet:summary:run` | Manually re-summarize the current session |

## Packages

| Package | Description |
|---------|-------------|
| `packages/unified-agent/` | **Unified SDK** — TypeScript SDK that unifies Codex CLI, Claude Code, and Gemini CLI over the ACP protocol. Provides both a CLI binary and a programmatic SDK with event-based streaming. |

## Archived specs (`.spsec/`)

| Directory | Description |
|-----------|-------------|
| `fleet-orchestration/` | Planning/spec materials for multi-agent orchestration |
| `fleet-task/` | Task system specification |
| `fleet-unit-explore/` | Exploration extension notes |
| `fleet-unit-librarian/` | Librarian extension notes |

## Setup

See [SETUP.md](SETUP.md) for step-by-step instructions.

### Quick Start (with LLM Agent)

Copy the prompt below and paste it into your LLM agent (Claude Code, Codex CLI, Gemini CLI, etc.):

> Install and configure pi-fleet by following the instructions here:
> `gh api repos/sbluemin/pi-fleet/contents/SETUP.md -H "Accept: application/vnd.github.raw+json"`

## License

MIT
