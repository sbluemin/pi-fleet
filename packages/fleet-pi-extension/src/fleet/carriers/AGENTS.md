# carriers

Default carrier definition library — defines individual carriers (genesis, kirov, nimitz, sentinel, vanguard, tempest, chronicle, ohio) that `carriers/index.ts` registers during boot, with `fleet/index.ts` calling that boot module. The documentation carrier additionally owns change-impact documentation and release communication within the documentation domain.

## Role

This library is responsible solely for **defining carrier instances** for the carrier framework SDK (`shipyard/carrier/`). Each carrier defines its own persona, prompt metadata, and display order (slot).

- `carriers/index.ts` is the only wiring point that registers these carrier modules, and `fleet/index.ts` boots that module.
- Without these modules, the `fleet/` extension still functions (framework SDK, Agent Panel, unified pipeline) but has no registered carriers.

## Architecture

```
carriers/
├── AGENTS.md          ← This file
├── index.ts           ← Internal boot module called by `fleet/index.ts`
├── nimitz.ts          ← Nimitz CVN-09 Strategic Command & Judgment — read-only (Claude Code)
├── kirov.ts           ← Kirov CVN-02 Operational Planning Bridge (Claude Code)
├── genesis.ts         ← Genesis CVN-01 Chief Engineer (Codex CLI)
├── ohio.ts            ← Ohio CVN-10 Multi-Wave Strike Execution (Codex CLI · receives Kirov plan_file; sole plan-driven executor)
├── sentinel.ts        ← Sentinel CVN-04 The Inquisitor / QA & Security Lead (Codex CLI)
├── vanguard.ts        ← Vanguard CVN-06 Scout Specialist (Codex CLI)
├── tempest.ts         ← Tempest CVN-07 Forward External Intelligence Strike (Gemini CLI)
└── chronicle.ts       ← Chronicle CVN-08 Chief Knowledge Officer (Gemini CLI · docs + change-impact reporting)
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
| `fleet/shipyard/*`, `fleet/panel/*`, `fleet/render/*`, `fleet/streaming/*` | `carriers/*` | framework internals must remain unaware of carrier persona modules |

### Summary

```
carriers/  →  fleet/shipyard/carrier/ (framework SDK only)
                    ✗ fleet/internal/
                    ✗ core/
```

## Core Rules

- **Each carrier file is independent** — defines its own persona, prompt metadata, and slot. Mutual imports between carriers are forbidden.
- **Prompt text belongs to each carrier file** — intentionally maintain prompts in each carrier file to allow for role divergence. Do not consolidate into `prompts.ts` (this rule is an explicit exception to the `prompts.ts` base rule in `package AGENTS.md`).
- **Slot must be unique across all carriers** — duplicate `CarrierConfig.slot` values will cause ordering conflicts in the Agent Panel.
- **Asynchronous Execution Doctrine**: All carrier tools (`sortie`, `taskforce`, `squadron`) invoked through the framework are **asynchronous (fire-and-forget)**. They return a `job_id` immediately; results must be retrieved via `[carrier:result]` push or `carrier_jobs` lookup.
- **`cliType` is automatically assigned and dynamically changeable** — `registerSingleCarrier` automatically sets `defaultCliType` upon registration, and users can change (override) this at runtime.
- **Only `carriers/index.ts` may import these files for boot-time registration** — `fleet/index.ts`는 `carriers/index.ts`만 호출하고, business logic은 각 carrier module 내부에 둔다.

## Slash Commands

Slash commands registered in this extension use the `fleet:carrier:` domain.

| Command | Description |
|---------|-------------|
| (To be added if needed in the future) | |
