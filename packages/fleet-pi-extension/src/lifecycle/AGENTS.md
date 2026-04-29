# lifecycle

Owns `pi.on(...)` lifecycle wiring for `fleet-pi-extension`.

## Scope

- Session, boot, agent, input, message-end, and shutdown listeners
- Event ordering and delegation into adapters, tools, TUI, or core runtime wrappers

## Rules

- Keep lifecycle ownership here even if the invoked domain logic lives in `fleet-core`.
- Do not move pure business logic into this bucket; call adapters or `fleet-core` APIs instead.
- `fleet-boot.ts` consumes `createFleetCoreRuntime`, supplies `panelStreamingSink`, and manages the `runtime.shutdown()` lifecycle (which includes resetting service status).
- `panelStreamingSink` (via the `AgentStreamingSink` port) uses the optional `AgentColumnStream` token to capture Pi `ExtensionContext` and column state at the start of a request, ensuring deterministic panel routing even if the host context shifts during long-running streaming operations.
- The Unified Agent global compat key `__pi_ua_request__` remains at the Pi adapter layer for backward compatibility.
- During Waves 12-13 this bucket remains under `src/lifecycle/`; Wave 14 later promotes it to the package root.
