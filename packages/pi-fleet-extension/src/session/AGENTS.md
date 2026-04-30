# session

Owns Pi session features that are not provider registration.

## Scope

- Foreground session coordination that uses Pi session state
- `runtime/` — owns Fleet boot/runtime initialization, `pi.on(...)` host event sequencing, and the Fleet boot host ports required by fleet-core runtime init
- `grand-fleet/` — owns Grand Fleet session runtime and Admiralty IPC wiring
- Active-run-safe wrappers for Fleet request execution
- Session-derived capture and HUD context helpers
- Carrier completion push delivery (`carrier-completion`) that is session-bound but not provider registration

## Rules

- Keep provider registration and provider lifecycle wiring in `src/provider/`.
- Keep session-bound Pi handling here; move provider-agnostic runtime behavior to `fleet-core`.
- Do not let background paths depend on Pi `ExtensionContext`.
