# tools

Owns `pi.registerTool(...)` and Pi-side tool renderer/message registration for `fleet-pi-extension`.

## Scope

- Pi tool registration adapters for sortie, squadron, taskforce, carrier jobs, wiki, and related surfaces
- Pi-specific message renderer wiring for custom carrier result delivery

## Rules

- Tool schemas and pure orchestration contracts should live in `fleet-core`; Pi registration lives here.
- Do not put detached-job domain logic back under legacy `src/fleet/shipyard/**` unless it is a temporary shim.
- Preserve current carrier completion push semantics and custom message type handling.
