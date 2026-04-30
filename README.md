<div align="center">
    <h1>pi-fleet</h1>
    <img src=".github/logo.png" alt="pi-fleet" width="640" />
    <h3><em>One Fleet. All LLMs.</em></h3>
</div>

<p align="center">
    <strong>A multi-LLM orchestration kit that operates Claude Code, Codex CLI, and Gemini CLI through a single unified interface — using native CLIs directly, no API wrapping or proxying.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.ko.md">한국어</a>
</p>

---

## Motivation

Each LLM CLI excels at different things — Claude at reasoning, Codex at fast code generation, Gemini at large-context analysis. But they all run in isolation. Combining their strengths on a single task means juggling separate terminals, copy-pasting context, and manually coordinating results.

pi-fleet solves this by treating LLM agents as **Carriers** within a naval **Fleet**. A central Admiral orchestrates multiple Carriers in parallel, each commanded by a specialized Captain persona. You give the order once; the fleet executes together.

## Naval Fleet Hierarchy

A 4-tier command structure maps users, orchestrators, and agents into clear roles:

- **Admiral of the Navy** — The user. Sets strategy and gives orders.
- **Fleet Admiral** — Multi-fleet orchestrator (Admiralty persona internalized in `fleet-core`).
- **Admiral** — A workspace PI instance. Plans and dispatches Carriers.
- **Captain** — The commander persona of a Carrier agent.

A **Carrier** is an execution instance of a CLI tool with isolated configuration. A **Captain** is the persona (e.g., Chief Engineer, Scout Specialist) that commands it.

## Carriers

> Per-carrier configuration (model selection, reasoning level, etc.) can be adjusted from the Fleet Bridge UI (`Alt+O`).

Eight built-in Carriers, each with a distinct operational role:

- **Nimitz** — Strategic Command & Judgment. Read-only architecture decisions and trade-off adjudication.
- **Kirov** — Operational Planning Bridge. Clarifies requirements and authors plan_file under .fleet/plans/*.md for Ohio.
- **Genesis** — Chief Engineer. Single-shot implementation under Admiral direction.
- **Ohio** — Multi-Wave Strike Execution. Consumes Kirov-authored plan_file and executes wave-by-wave to completion.
- **Sentinel** — QA & Security Lead. Code review, defect detection, and vulnerability hunting.
- **Vanguard** — Scout Specialist. Codebase exploration, symbol tracing, and web research.
- **Tempest** — Forward External Intelligence Strike. GitHub intelligence and external repo analysis.
- **Chronicle** — Chief Knowledge Officer. Documentation, changelogs, and change-impact reporting.

## Features

### Multi-LLM Orchestration

- Parallel carrier execution with unified progress tracking
- Per-carrier model and reasoning level configuration
- Protocol system for different operational modes (Fleet Action, Positive Control)

### HUD

- Integrated editor with status bar and footer
- Metaphor-based directive refinement (3-section) and session operation naming
- Auto session summary and thinking timer

### Fleet Bridge

- Real-time streaming UI for all active carriers
- Inline navigation between carrier slots
- Detail view toggle for focused monitoring

### Carrier Sortie

- Fire-and-forget delegation to one or more carriers
- Single-carrier dispatch as well as parallel multi-carrier dispatch in one call
- Asynchronous result delivery via push notifications and `carrier_jobs` lookup

### Squadron

- Fan out independent subtasks to parallel instances of the same carrier
- Divide-and-conquer execution for batch analysis or per-file processing
- Up to 10 concurrent subtasks per dispatch

### Task Force

- Cross-validate a carrier's response across multiple CLI backends simultaneously
- Compare approaches, detect blind spots, and build multi-model consensus

### Fleet Wiki Experimental Extension

- Experimental workspace-local `.fleet/knowledge/` store with raw sources, wiki entries, schema/doctrine space, patch queue/archive, and conflict records
- Human-gated wiki patches: ingest proposes wiki changes, approval merges them, and rejection leaves wiki untouched
- Deterministic briefing, dry-dock lint, and `fleet:wiki:*` slash commands for observable review when `PI_EXPERIMENTAL=1`
- Staged `fleet:wiki:capture` session capture that can create approval-gated wiki pending patches or run preview-only review

## Commands

After `pnpm link --global` (see [SETUP.md](SETUP.md)), five global commands are available:

| Command | Description |
|---------|-------------|
| `fleet` | Launch standard Fleet mode |
| `fleet-exp` | Launch standard Fleet mode with `PI_EXPERIMENTAL=1` enabled |
| `gfleet` | Launch Grand Fleet mode |
| `fleet-dev` | Standard Fleet mode with `PI_EXPERIMENTAL=1`, loading `packages/pi-fleet-extension/src/index.ts` from the current checkout |
| `gfleet-dev` | Grand Fleet mode with `PI_EXPERIMENTAL=1`, loading `packages/pi-fleet-extension/src/index.ts` from the current checkout |

## Setup

See [SETUP.md](SETUP.md) for step-by-step instructions.

> **Quick Start with AI Agent** — Copy and paste into your LLM agent:
>
> Install and configure pi-fleet by following the instructions here: `https://raw.githubusercontent.com/sbluemin/pi-fleet/main/SETUP.md`

## Documentation

- [PI Development Reference](./docs/pi-development-reference.md) — The comprehensive guide for developing PI extensions and using the SDK.
- [Admiral Workflow Reference](./docs/admiral-workflow-reference.md) — Deep dive into the naval fleet architecture and operational doctrine.
- [CHANGELOG](./CHANGELOG.md) — Project history and release notes.

## License

MIT
