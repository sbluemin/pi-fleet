# Experimental Extensions

> This is the development space for experimental extensions. All new extensions start here.

## Current Extensions

| Extension | Description |
|-----------|-------------|
| `subagent-explore/` | Sub-agent based exploration tool |
| `subagent-librarian/` | Sub-agent based library research tool |
| `unified-agent-orchestration/` | Multi-agent orchestration |
| `unified-agent-task/` | Unified agent task execution |

## Activation

`experimental/` is **disabled** by default. Activate it inside pi with the following command.

```
/fleet:system:experimental on
```

## Development Rules

- **All new extensions must start in this directory** — Do not create extensions directly under the parent `extensions/`.
- Follow the Extension Authoring Guide in the parent `extensions/AGENTS.md` for structure and conventions.
- A directory with `index.ts` is recognized as an extension by pi. (Without `index.ts`, it is treated as a shared library.)

## Promotion / Demotion

| Action | Condition |
|--------|-----------|
| `experimentals/` → `extensions/` | Requires **explicit user instruction** |
| `extensions/` → `experimentals/` | Requires **explicit user instruction** |

Do not move extensions autonomously.
