# session-bridge

Owns Pi session/provider glue for `fleet-pi-extension`.

## Scope

- `pi.registerProvider(...)` wiring
- Foreground session coordination, active-run-safe wrappers, and provider/session lifecycle bridges

## Rules

- Keep session-bound Pi handling here; move provider-agnostic runtime behavior to `fleet-core`.
- Do not let background paths depend on Pi `ExtensionContext`.
