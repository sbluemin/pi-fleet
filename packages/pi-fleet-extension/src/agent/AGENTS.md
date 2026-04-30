# agent

Owns Pi-side agent capability registration and runtime glue for `pi-fleet-extension`. This domain mirrors `AgentServices` from `fleet-core`.

## Scope

- `registerAgent(ctx)` — single agent capability entry point
- `provider.ts` — the sole `@mariozechner/pi-ai` gateway; provider registration wiring lives under `provider-internal/`
- `runner.ts` — operation runner and background carrier request adapter
- `carrier-completion.ts` — carrier completion push delivery
- `ui/` — Agent Panel, Streaming Widget, carrier status UI, and ACP shell UI

## Rules

- **Gateway Policy**: Keep direct `@mariozechner/pi-ai` imports confined to `src/agent/provider.ts`; other adapters must consume that provider gateway through exported bridge functions.
- **Domain Focus**: Non-agent Pi runtime features live in their respective domain files (e.g., `fleet.ts`, `job.ts`) or the `shell/` domain.
- Move provider-agnostic runtime behavior to `fleet-core`.
- Do not let background paths depend on Pi `ExtensionContext`.
- Tool definitions used by the agent must be consumed from `fleet-core` registries via the `tool-registry.ts` adapter.
