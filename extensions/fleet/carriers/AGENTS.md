# carriers

Default carrier definition library — defines individual carriers (genesis, athena, sentinel, vanguard, echelon, chronicle, oracle) that `carriers/index.ts` registers during boot, with `fleet/index.ts` calling that boot module. Chronicle additionally owns change-impact documentation and release communication within the documentation domain.

## Role

This library is responsible solely for **defining carrier instances** for the carrier framework SDK (`shipyard/carrier/`). Each carrier defines its own persona, prompt metadata, and display order (slot).

- `carriers/index.ts` is the only wiring point that registers these carrier modules, and `fleet/index.ts` boots that module.
- Without these modules, the `fleet/` extension still functions (framework SDK, Agent Panel, unified pipeline) but has no registered carriers.

## Architecture

```
carriers/
├── AGENTS.md          ← This file
├── index.ts           ← Internal boot module called by `fleet/index.ts`
├── genesis.ts         ← CVN-01 Chief Engineer (Codex CLI)
├── athena.ts          ← CVN-02 Strategic Planning Officer (Claude Code)
├── oracle.ts          ← CVN-09 Read-Only Strategic Technical Advisor (Claude Code)
├── sentinel.ts        ← CVN-04 The Inquisitor / QA & Security Lead (Codex CLI)
├── vanguard.ts        ← CVN-06 Scout Specialist (Codex CLI)
├── echelon.ts         ← CVN-07 Chief Intelligence Officer (Gemini CLI)
└── chronicle.ts       ← CVN-08 Chief Knowledge Officer (Gemini CLI · docs + change-impact reporting)
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
- **Prompt text belongs to each carrier file** — intentionally maintain prompts in each carrier file to allow for role divergence. Do not consolidate into `prompts.ts` (this rule is an explicit exception to the `prompts.ts` base rule in `extensions/AGENTS.md`).
- **Slot must be unique across all carriers** — duplicate `CarrierConfig.slot` values will cause ordering conflicts in the Agent Panel.
- **`cliType` is automatically assigned and dynamically changeable** — `registerSingleCarrier` automatically sets `defaultCliType` upon registration, and users can change (override) this at runtime.
- **Only `carriers/index.ts` may import these files for boot-time registration** — `fleet/index.ts`는 `carriers/index.ts`만 호출하고, business logic은 각 carrier module 내부에 둔다.

## Slash Commands

Slash commands registered in this extension use the `fleet:carrier:` domain.

| Command | Description |
|---------|-------------|
| (To be added if needed in the future) | |
