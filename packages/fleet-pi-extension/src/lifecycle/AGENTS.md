# lifecycle

Owns `pi.on(...)` lifecycle wiring for `fleet-pi-extension`.

## Scope

- Session, boot, agent, input, message-end, and shutdown listeners
- Event ordering and delegation into adapters, tools, TUI, or core runtime wrappers

## Rules

- Keep lifecycle ownership here even if the invoked domain logic lives in `fleet-core`.
- Do not move pure business logic into this bucket; call adapters or `fleet-core` APIs instead.
- During Waves 12-13 this bucket remains under `src/lifecycle/`; Wave 14 later promotes it to the package root.
