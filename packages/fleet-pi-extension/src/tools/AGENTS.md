# tools

Owns `pi.registerTool(...)` and Pi-side tool renderer/message registration for `fleet-pi-extension`.

## Scope

- Pi tool registration adapters for sortie, squadron, taskforce, carrier jobs, wiki, and related surfaces
- Pi-specific message renderer wiring for custom carrier result delivery
- Adapter loops that iterate host-agnostic `fleet-core` tool specs and register them with `pi.registerTool(...)`

## Rules

- Tool schemas and pure orchestration contracts should live in `fleet-core`; Pi registration lives here.
- New pure `execute` logic, schema construction, prompt snippets, or tool manifests should not be added here when they can be represented as `fleet-core` tool specs.
- Do not put detached-job domain logic back under legacy `src/fleet/shipyard/**` unless it is a temporary shim.
- Preserve current carrier completion push semantics and custom message type handling.
