# provider

Owns Pi provider registration and provider lifecycle glue for `pi-fleet-extension`.

## Scope

- `pi.registerProvider(...)` wiring
- Provider stream wiring
- Provider-specific lifecycle handling and service status integration

## Rules

- Keep provider registration here; keep non-provider Pi session features in `src/session/`.
- Move provider-agnostic runtime behavior to `fleet-core`.
- Do not let background paths depend on Pi `ExtensionContext`.
