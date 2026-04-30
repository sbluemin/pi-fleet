# session

Owns Pi session features that are not provider registration.

## Scope

- Foreground session coordination that uses Pi session state
- Active-run-safe wrappers for Fleet request execution
- Session-derived capture and HUD context helpers

## Rules

- Keep provider registration and provider lifecycle wiring in `src/provider/`.
- Keep session-bound Pi handling here; move provider-agnostic runtime behavior to `fleet-core`.
- Do not let background paths depend on Pi `ExtensionContext`.
