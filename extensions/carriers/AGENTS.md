# carriers

**Independent carrier registration extension** — defines individual carriers (genesis, arbiter, crucible, sentinel, raven, vanguard, echelon, chronicle, oracle) as a standalone, optional extension. Chronicle additionally owns change-impact documentation and release communication within the documentation domain.

## Role

This extension is responsible solely for **registering carrier instances** with the carrier framework SDK (`shipyard/carrier/`). Each carrier defines its own persona, prompt metadata, and slot assignment.

- This extension is **optional** — users may omit it from `settings.json` if they do not want any carriers.
- Without this extension, the `fleet/` extension still functions (framework SDK, Agent Panel, unified pipeline) but has no registered carriers.

## Architecture

```
carriers/
├── AGENTS.md          ← This file
├── index.ts           ← Extension entry point (wiring only — imports and registers all carriers)
├── genesis.ts         ← CVN-01 Chief Engineer (Claude Code)
├── arbiter.ts         ← CVN-02 Chief Doctrine Officer (Claude Code) ← slot 3
├── crucible.ts        ← CVN-03 Chief Forgemaster (Codex CLI) ← slot 2
├── sentinel.ts        ← CVN-04 The Inquisitor (Codex CLI)
├── raven.ts           ← CVN-05 Red Team Commander (Codex CLI)
├── vanguard.ts        ← CVN-06 Scout Specialist (Gemini CLI)
├── echelon.ts         ← CVN-07 Chief Intelligence Officer (Gemini CLI)
├── chronicle.ts       ← CVN-08 Chief Knowledge Officer (Gemini CLI · docs + change-impact reporting)
└── oracle.ts          ← CVN-09 Read-Only Strategic Technical Advisor (Claude Code)
```

## Dependency Rules

### Allowed Imports

| Source | Allowed Target | Notes |
|--------|---------------|-------|
| `carriers/*` | `fleet/shipyard/carrier/` | Framework SDK — `registerSingleCarrier`, `CarrierConfig`, types |
| `carriers/*` | `@mariozechner/pi-coding-agent` | Extension API types |
| `carriers/*` | `@sinclair/typebox` | Schema definitions (if needed) |

### Forbidden Imports

| Source | Forbidden Target | Reason |
|--------|-----------------|--------|
| `carriers/*` | `fleet/index.ts` | carriers do not depend on the fleet extension — use only framework SDK |
| `carriers/*` | `fleet/internal/*` | fleet internal implementation is not a concern for carriers |
| `carriers/*` | `fleet/operation-runner.ts` | execution pipeline is accessed indirectly via framework SDK |
| `carriers/*` | `core/*` | direct dependency on other extension layers is forbidden |
| `fleet/*` | `carriers/*` | fleet core is unaware of carriers (no reverse dependency) |

### Summary

```
carriers/  →  fleet/shipyard/carrier/ (framework SDK only)
                    ✗ fleet/index.ts
                    ✗ fleet/internal/
                    ✗ core/
```

## Core Rules

- **`index.ts` is for wiring only** — imports and registers carrier files only. No business logic allowed.
- **Each carrier file is independent** — defines its own persona, prompt metadata, and slot. Mutual imports between carriers are forbidden.
- **Prompt text belongs to each carrier file** — intentionally maintain prompts in each carrier file to allow for role divergence. Do not consolidate into `prompts.ts` (this rule is an explicit exception to the `prompts.ts` base rule in `extensions/AGENTS.md`).
- **Slot must be unique across all carriers** — duplicate `CarrierConfig.slot` values will cause keybinding conflicts.
- **`cliType` is automatically assigned and dynamically changeable** — `registerSingleCarrier` automatically sets `defaultCliType` upon registration, and users can change (override) this at runtime.

## Slash Commands

Slash commands registered in this extension use the `fleet:carrier:` domain.

| Command | Description |
|---------|-------------|
| (To be added if needed in the future) | |
