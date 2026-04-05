# admiral

Admiral **prompt policy** extension — system prompt injection, worldview toggle, and settings section ownership.

This extension is **independent** of `fleet/` and `carriers/`. It depends only on `core/settings` (infrastructure layer).

## Responsibilities

| Responsibility | Implementation |
|----------------|----------------|
| System prompt injection (`before_agent_start`) | `index.ts` — appends Admiral directives and optional worldview prompt |
| Worldview toggle command | `index.ts` — `fleet:admiral:worldview` command |
| Settings section ("Admiral") | `index.ts` — registers in Alt+/ popup, owns `admiral` settings key |
| Prompt constants & settings logic | `prompts.ts` — `FLEET_WORLDVIEW_PROMPT`, `ADMIRAL_SYSTEM_APPEND`, read/write helpers |

## Settings

The settings key is `admiral.worldview`.

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point (wiring only) — `before_agent_start` hook, command registration, settings section |
| `prompts.ts` | Prompt constants (`FLEET_WORLDVIEW_PROMPT`, `ADMIRAL_SYSTEM_APPEND`) + settings read/write |

## Core Rules

- **No direct dependency on `fleet/` or `carriers/`** — admiral operates independently.
- **Dependency direction**: `admiral/` → `core/` only.
- **Command naming**: follows `fleet:<domain>:<feature>` form — `fleet:admiral:worldview`.
- **Prompt text lives in `prompts.ts`** — following the parent `AGENTS.md` convention.
- **Settings key is `admiral`** — not `fleet`.
