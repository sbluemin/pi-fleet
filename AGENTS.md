# Fleet

> **A Multi-LLM Orchestration Kit**
>
> A custom extension fleet based on [pi-coding-agent](https://github.com/badlogic/pi-mono).
> The core purpose is to operate 9 carriers — Claude Code, Codex CLI, and Gemini CLI — through a single unified interface.

## Structure

| Path | Description |
|------|-------------|
| `packages/` | Embedded first-party libraries (e.g., `unified-agent`) |
| `extensions/` | All extensions consolidated here (refer to its own `AGENTS.md`) |
| `extensions/fleet/` | Agent orchestration extension — carrier framework, unified pipeline, Agent Panel (refer to its own `AGENTS.md`) |
| `extensions/carriers/` | Carrier registrations — independent extension that defines individual carriers (refer to its own `AGENTS.md`) |
| `extensions/core/` | Infrastructure + utility extensions — agent infra, hud, keybind, settings, welcome, shell, improve-prompt, summarize, thinking-timer, provider-guard (refer to its own `AGENTS.md`) |

> Currently, there is no `pi/` directory — symlink setup is not required.

## Fleet Architecture (Metaphor)

This project is an **Agent Harness** that centrally commands and orchestrates powerful CLI tools (Claude Code, Codex, Gemini, etc.), each of which possesses its own internal sub-agent system.

Beyond simple parallel API calls, the system adopts a **naval fleet metaphor** to clearly separate roles and responsibilities across the architecture.

### Core Entities

| Entity | Metaphor | Definition |
|--------|----------|------------|
| **Fleet** | The fleet | The logical unit encompassing the entire agent harness system. |
| **Fleet Admiral** | Supreme commander | The **user** who wields the tool. Sets the ultimate strategy and final objectives for the fleet. |
| **Admiral** | Fleet commander | The **main orchestrator (PI's LLM router)** that plans operations and issues commands to the entire fleet on behalf of the Fleet Admiral. |
| **Carrier** | Aircraft carrier | An **execution instance (process)** of an individual CLI tool such as Genesis (Claude Code), Sentinel (Codex), or Vanguard (Gemini). A large, independent asset with its own internal sub-agent ecosystem. Each carrier has its own persona and configuration, managed in the `carriers/` extension. |

## Architecture — Agent Workflow

PI is the **host agent** (orchestrator). Genesis, Sentinel, and Vanguard are **sub-agents** that execute independently via ACP protocol.

### Speakers

| Speaker | Role |
|---------|------|
| **PI** (host) | Orchestrator — routes requests, invokes tools, synthesizes cross-reports |
| **Genesis** (sub) | CVN-01 Chief Engineer (Claude Code CLI via ACP) |
| **Athena** (sub) | CVN-02 Strategic Planning Officer (Claude Code CLI via ACP) |
| **Oracle** (sub) | CVN-09 Strategic Technical Advisor — read-only (Claude Code CLI via ACP) |
| **Sentinel** (sub) | CVN-04 The Inquisitor / QA & Security Lead (Codex CLI via ACP) |
| **Vanguard** (sub) | CVN-06 Scout Specialist (Gemini CLI via ACP) |
| **Echelon** (sub) | CVN-07 Chief Intelligence Officer (Gemini CLI via ACP) |
| **Chronicle** (sub) | CVN-08 Chief Knowledge Officer — documentation, change-impact summaries, and release communication (Gemini CLI via ACP) |

### Execution Modes

| Mode | Trigger | Flow |
|------|---------|------|
| **Fleet Action** | Alt+1 (Active Protocol) | PI handles directly (no sub-agents) — Standard workflow |
| **Tool delegation** | PI's own judgment | PI → tool_call(any carrier) → sub-agent result → PI synthesizes |
| **Bridge (single)** | Alt+H/L → Ctrl+Enter | User → single sub-agent (PI acts as router only, no synthesis) |

## Operational Protocols & Standing Orders

The Admiral extension implements a modular prompt policy system that governs how the host agent (PI) operates. This system is composed of **Standing Orders** and **Protocols**.

### Core Concepts

| Concept | Definition | Scope |
|---------|------------|-------|
| **Standing Orders** | Cross-cutting mechanisms always injected into the system prompt. | Global — applies to all sessions and protocols. |
| **Protocols** | Mutually exclusive workflows that define the current operational mode. | Session-specific — exactly one protocol is always active. |

### Standing Orders

- **Delegation Policy**: Defines how and when PI should delegate tasks to carriers.
- **Deep Dive**: Strategy for recursive investigation and root-cause analysis.
- **Always Active**: These are injected into every agent start sequence regardless of the selected protocol.

### Protocols

- **Fleet Action Protocol (Alt+1)**: The default, high-performance workflow for standard operations.
- **Modular Expansion**: Additional protocols (e.g., specific research or refactoring modes) can be assigned to `Alt+2` through `Alt+9`.
- **Switching**: Protocols are switched via dedicated hotkeys. Only one protocol can be active at a time; deactivation is not possible (switching only).

### Prompt Structure

The final system prompt delivered to the LLM is synthesized as follows:

```text
System Prompt
  + [Toggle] Worldview (via fleet:admiral:worldview)
  + [Always] Standing Orders (Delegation Policy + Deep Dive + ...)
  + [Always] Active Protocol (Fleet Action Protocol, etc.)
  + [Always] request_directive guide
```

### UI & UX Integration

- **Editor Border Color**: The editor's border color changes based on the active protocol (communicated via `globalThis.__pi_hud_editor_border_color__`).
- **aboveEditor Widget**: Displays the active protocol label (e.g., `⚓ Fleet Action Protocol`) above the input field.
- **Settings Popup (Alt+/)**: The "Admiral" section allows manual selection of the `activeProtocol` and toggling of the `worldview`.

### Key Bindings

| Key | Protocol / Action |
|-----|-------------------|
| **Alt+1** | Switch to Fleet Action Protocol |
| **Alt+2~9** | Switch to dynamically assigned protocols |
| **Alt+/** | Open Settings (to configure Admiral parameters) |

## Fleet Architecture (Metaphor)


- **Sub-agents are fully independent** — PI provides only background, objectives, and constraints. Never prescribe implementation details.
- **Sub-agents are unaware of each other** — Cross-analysis is performed solely by PI after all responses are collected.
- **Communication layer**: `runAgentRequest()` → `executeWithPool()` → ACP stdio (all CLIs use the same protocol).

## PI TUI Layout & Terminology

PI renders a vertical stack of **zones**. Extensions customize these zones via official TUI APIs.

```
┌──────────────────────────────────┐
│  Header                          │  built-in
├──────────────────────────────────┤
│  Messages                        │  built-in · registerMessageRenderer()
├──────────────────────────────────┤
│  Widget:above                    │  setWidget()
├──────────────────────────────────┤
│  Editor                          │  setEditorComponent()
├──────────────────────────────────┤
│  Widget:below                    │  setWidget()
├──────────────────────────────────┤
│  Footer                          │  setFooter()
└──────────────────────────────────┘
  Overlay                            ctx.ui.custom() — floating
```

### Canonical Terms

| Term | Zone | Owner | Notes |
|------|------|-------|-------|
| **Header** | Header | pi | Startup info, badges |
| **Messages** | Messages | pi | Conversation, tool calls/results, custom messages |
| **Editor** | Editor | `core/hud` | User input (HUD replaces default) |
| **Footer** | Footer | `core/hud` | Bottom tokens — dir, session, cost, model (HUD replaces default) |
| **Status Bar** | Widget:above | `core/hud` | Segment-based status line above Editor |
| **Agent Panel** | Custom UI | `fleet` | Carrier streaming UI — exclusive / multi-column / compact view |
| **Streaming Widget** | Widget | `fleet` | 1-line compact indicator when Agent Panel is collapsed |
| **Overlay** | Overlay | various | Floating panel — keybind (Alt+.), settings (Alt+/), welcome |

### Rules

- Use the **canonical terms** above in all code comments, docs, and AGENTS.md files.
- When an extension contributes UI, note which **zone** and **API** it targets.

## Domain Boundary Rules

> Refer to `extensions/AGENTS.md` for the full cross-layer dependency rules, layer hierarchy, and verification table.

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
| `fleet/` | `agent` | Sub-agent orchestration features |
| `admiral/` | `admiral` | Host-agent prompt policy, worldview, and operational doctrine |
| `carriers/` | `carrier` | Individual carrier registration and configuration |
| `core/hud/` | `hud` | HUD / editor display features |
| `core/improve-prompt/` | `prompt` | Meta-prompt model and reasoning settings |
| `core/summarize/` | `summary` | Session summarization settings |
When adding a **new extension**, assign a domain that reflects the **feature category**, not the directory prefix (`core-`, etc.).

### Feature Naming

- Use a **verb or noun** that describes the action or target — e.g., `status`, `editor`, `models`, `settings`, `worldview`.
- Prefer short, unambiguous words. Avoid abbreviations (`settings` not `cfg`, `status` not `stat`).
- `settings` — reserved for commands that open a configuration UI for that domain.
- `run` — reserved for manual re-trigger of an automated behavior (e.g., re-summarize on demand).

### Conflict Prevention

- The `fleet:` prefix is **reserved for this project**. Never register commands without it.
- Domain names are shared across extensions — coordinate to avoid feature name collisions within a domain.

### When to Apply

- Apply this naming from the **first `registerCommand` call** in a new extension — do not rename later.
- Commands without the `fleet:` prefix must be renamed before they are merged into active extensions.

## TypeScript File Structure

All `.ts` source files must follow this top-to-bottom declaration order:

```
imports → types/interfaces → constants → functions
```

- **Imports** — external packages first, then internal modules.
- **Types / Interfaces** — `interface` and `type` declarations only; no logic.
- **Constants** — `const` declarations. Module-private constants are `const` (unexported); public ones are `export const`.
- **Functions** — exported functions first, then internal helpers at the bottom.

Do **not** interleave constants and functions, or declare types mid-file.

## Git Guidelines

- **Commit Message Format:** Strictly adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification.
  - Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Language:** All commit messages **MUST be written in English**.
