# fleet-core Doctrine

`packages/fleet-core` is the Pi-agnostic Fleet product core. It owns Fleet domain logic, prompt assets, tool contracts, MCP/runtime internals, job services, bridge data/state layers, and adapter-facing public APIs.

## Wave 12 Migration Status

- The **ownership model is already final**: Fleet domain logic belongs in `fleet-core`; Pi runtime integration belongs in `fleet-pi-extension`.
- The current implementation still lives under `packages/fleet-core/src/`.
- `packages/fleet-pi-extension` also still uses `src/` during the intermediate migration stage.
- **Wave 14 has not happened yet**. Do not document or assume that `packages/fleet-pi-extension/src/` has already been physically removed.

## Owns

- Fleet domain modules such as `admiral/`, `agent/`, `boot/`, `bridge/`, `carrier/`, `carrier-jobs/`, `core-services/`, `grand-fleet/`, `job/`, `metaphor/`, `operation/`, `push/`, `squadron/`, `store/`, and `taskforce/`
- Public API contracts and frozen consumer surfaces
- Global runtime stores and compatibility keys used by Pi adapters
- Pure prompt composition and domain-level orchestration logic

## Must Not Own

- `ExtensionAPI`, `ExtensionContext`, `pi.on(...)`, `pi.registerTool(...)`, `pi.registerCommand(...)`, `pi.registerShortcut(...)`, `pi.registerProvider(...)`, or `pi.sendMessage(...)`
- `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, or any Pi runtime wiring
- Direct `@mariozechner/pi-ai` usage
- TUI rendering that depends on Pi widgets, overlays, or editor components

## Import Boundaries

- Do not import `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`, or `@anthropic-ai/*`.
- Public consumers must use the package root barrel or documented public subpaths only.
- `fleet-core` may expose ports, adapters, and pure state machines, but Pi implementations live in `fleet-pi-extension`.
- If a module needs Pi lifecycle hooks or UI registration, that code belongs in `fleet-pi-extension`, not here.

## Migration Guardrails

- Do not reintroduce Fleet domain folders back into `packages/fleet-pi-extension/src/fleet/**`, `src/grand-fleet/**`, `src/metaphor/**`, or similar legacy Pi-side domain homes.
- Do not add new deep-import dependencies from `fleet-pi-extension` into `fleet-core/src/**`; use public exports.
- When splitting mixed modules, move the pure/domain half into `fleet-core` and keep only the Pi adapter half in `fleet-pi-extension`.
- Intermediate re-export shims are a migration artifact only; do not treat them as long-term architecture.

## Invariants

- `api/PUBLIC_API.md` is the frozen public API contract for the productization migration.
- Provider MCP FIFO, token isolation, pre-queue, and HTTP-hold behavior are invariants.
- Preserve existing `globalThis` compatibility keys exactly unless a higher-order doctrine explicitly changes them.
- Background paths must accept plain runtime data and host ports, never Pi `ExtensionContext`.
- Job archive behavior remains read-many within TTL.
