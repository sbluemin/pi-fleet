# Fleet

> **A Multi-LLM Orchestration Kit**
>
> A custom extension fleet based on [pi-coding-agent](https://github.com/badlogic/pi-mono).
> The core purpose is to operate Claude Code, Codex CLI, and Gemini CLI integrated within a single interface.

## Structure

| Path | Description |
|------|-------------|
| `packages/` | Embedded first-party libraries (e.g., `unified-agent`) |
| `extensions/` | Collection of pi extensions and shared libraries (refer to its own `AGENTS.md`) |
| `experimental/` | Experimental extensions under active development (refer to the Extension Lifecycle below) |

> Currently, there is no `pi/` directory — symlink setup is not required.

## Architecture — Agent Workflow

PI is the **host agent** (orchestrator). Claude, Codex, and Gemini are **sub-agents** that execute independently via ACP protocol.

### Speakers

| Speaker | Role |
|---------|------|
| **PI** (host) | Orchestrator — routes requests, invokes tools, synthesizes cross-reports |
| **Claude** (sub) | Independent coding agent (Claude Code CLI via ACP) |
| **Codex** (sub) | Independent coding agent (Codex CLI via ACP) |
| **Gemini** (sub) | Independent coding agent (Gemini CLI via ACP) |

### Execution Modes

| Mode | Trigger | Flow |
|------|---------|------|
| **Default** | Normal chat | PI handles directly (no sub-agents) |
| **Tool delegation** | PI's own judgment | PI → tool_call(claude/codex/gemini) → sub-agent result → PI synthesizes |
| **Direct (single)** | Alt+1/2/3 | User → single sub-agent (PI acts as router only, no synthesis) |
| **All (3-split)** | Alt+0 | User → 3 sub-agents in parallel → PI generates cross-analysis report |
| **Claude & Codex (2-split)** | Alt+9 | User → 2 sub-agents in parallel → PI generates cross-analysis report |

### Key Principles

- **Sub-agents are fully independent** — PI provides only background, objectives, and constraints. Never prescribe implementation details.
- **Sub-agents are unaware of each other** — Cross-analysis is performed solely by PI after all responses are collected.
- **Communication layer**: `runAgentRequest()` → `executeWithPool()` → ACP stdio (all CLIs use the same protocol).

## Extension Lifecycle

All new extensions **MUST** be developed under `experimental/` first.

### Development Flow

```
experimental/<name>/   →   (explicit promotion)   →   extensions/<name>/
```

### Rules

- **New extensions start in `experimental/`** — Do not create new extensions directly under `extensions/`.
- **`experimental/` is opt-in** — Users activate it via `/fleet:system:experimental on`. It is disabled by default.
- **Promotion to `extensions/` requires explicit instruction** — An extension is moved from `experimental/` to `extensions/` only when the user explicitly requests it. Do not promote autonomously.
- **Demotion is also explicit** — Moving an extension back from `extensions/` to `experimental/` also requires explicit user instruction.

## Slash Command Naming

All slash commands registered by extensions must follow this naming convention.

### Format

```
fleet:<domain>:<feature>
```

- **All lowercase** — No uppercase letters, no underscores.
- **`:` as separator** — Use `:` between segments. Do not use `-`, `_`, or `/`.
- **Exactly 3 segments** — `fleet` prefix + domain + feature. Do not nest further.

### Domain Assignment

Each extension maps to exactly one domain. Use the domain below for all commands registered by that extension.

| Extension | Domain | Rationale |
|-----------|--------|-----------|
| `unified-agent-direct/` | `agent` | Sub-agent orchestration features |
| `infra-hud/` | `hud` | HUD / editor display features |
| `infra-experimental/` | `system` | System-level toggles and infra controls |
| `utils-summarize/` | `summary` | Session summary features |
| `utils-improve-prompt/` | `prompt` | Prompt improvement features |

When adding a **new extension**, assign a domain that reflects the **feature category**, not the directory prefix (`infra-`, `utils-`, etc.).

### Feature Naming

- Use a **verb or noun** that describes the action or target — e.g., `run`, `status`, `editor`, `improve`, `reasoning`.
- Prefer short, unambiguous words. Avoid abbreviations (`settings` not `cfg`, `status` not `stat`).
- `settings` — reserved for commands that open a configuration UI for that domain.
- `run` — reserved for manual re-trigger of an automated behavior (e.g., re-summarize on demand).

### Conflict Prevention

- The `fleet:` prefix is **reserved for this project**. Never register commands without it.
- Domain names are shared across extensions — coordinate to avoid feature name collisions within a domain.

### When to Apply

- Apply this naming from the **first `registerCommand` call** in a new extension — do not rename later.
- Commands without the `fleet:` prefix must be renamed **before promotion** from `experimental/` to `extensions/`.

## Git Guidelines

- **Commit Message Format:** Strictly adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification.
  - Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Language:** All commit messages **MUST be written in English**.
