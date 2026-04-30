# provider

Owns Pi provider registration and provider lifecycle glue for `pi-fleet-extension`.

## Scope

- `pi.registerProvider(...)` wiring
- Provider stream wiring
- Provider-specific lifecycle handling and service status integration
- Provider-owned Pi AI SDK gateway at `src/provider/pi-ai-bridge.ts` (The sole gateway for Pi AI interactions)

## Rules

- Keep provider registration here; keep non-provider Pi session features in `src/session/`.
- **Gateway Policy**: Keep direct `@mariozechner/pi-ai` imports confined to `pi-ai-bridge.ts`; other buckets must consume that provider gateway through `ExtensionAPI` or exported bridge functions.
- Move provider-agnostic runtime behavior to `fleet-core`.
- Do not let background paths depend on Pi `ExtensionContext`.
