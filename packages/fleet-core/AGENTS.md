# fleet-core Doctrine

`packages/fleet-core` is the Pi-agnostic Fleet product core. It owns Fleet domain logic, prompt assets, tool contracts, MCP/runtime internals, job services, bridge data/state layers, and adapter-facing public APIs.

## Current Architecture Status

- The **ownership model is already final**: Fleet domain logic belongs in `fleet-core`; Pi runtime integration belongs in `pi-fleet-extension`.
- The current implementation still lives under `packages/fleet-core/src/`.
- `packages/pi-fleet-extension` uses `src/` as the active Pi capability-bucket home.
- Do not document or assume that Pi capability buckets have moved out of `packages/pi-fleet-extension/src/`.

## Owns

- Fleet domain modules such as `admiral/`, `agent/`, `bridge/` (including `run-stream/`, `carrier-panel/`, and `carrier-control/`), `carrier/`, `gfleet/`, `job/` including `job/carrier-jobs/`, `core-services/`, `metaphor/`, `squadron/`, `store/`, and `taskforce/`
- Public API contracts and frozen consumer surfaces
- `createFleetCoreRuntime` as the canonical composition entry point that initializes the runtime-owned state (data directory, storage, settings) and optional service status tracking; it also owns the `shutdown` lifecycle that cleans up the agent, resets the settings service, and cleans up service status state
- `AgentRequestService` owns unified-agent request orchestration and emits host column lifecycle through `FleetHostPorts.streamingSink`; it supports an optional `AgentColumnStream` token for stateful host tracking from `onColumnBegin` to `onColumnEnd`
- Fleet tool specs and registry factories that are host-agnostic and registered by adapters through public APIs
- Global runtime stores, **runtime-owned settings singletons (owned by `core-services/settings`)**, **`BridgeStateStorage` (owned by `bridge/run-stream`)**, and compatibility keys used by Pi adapters
- Pure prompt composition, domain-level orchestration logic, and **render-agnostic view-model builders**
- The Fleet Wiki domain extracted to the leaf `packages/fleet-wiki`

## Must Not Own

- `ExtensionAPI`, `ExtensionContext`, `pi.on(...)`, `pi.registerTool(...)`, `pi.registerCommand(...)`, `pi.registerShortcut(...)`, `pi.registerProvider(...)`, or `pi.sendMessage(...)`
- `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, or any Pi runtime wiring
- Direct `@mariozechner/pi-ai` usage
- TUI rendering that depends on Pi widgets, overlays, or editor components

## Import Boundaries

- Do not import `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`, or `@anthropic-ai/*`.
- Public consumers must use the package root barrel or documented public subpaths only.
- `fleet-core` may expose ports, adapters, and pure state machines, but Pi implementations live in `pi-fleet-extension`.
- If a module needs Pi lifecycle hooks or UI registration, that code belongs in `pi-fleet-extension`, not here.

## Migration Guardrails

- Do not reintroduce Fleet domain folders back into `packages/pi-fleet-extension/src/fleet/**`, `src/grand-fleet/**`, `src/metaphor/**`, or similar legacy Pi-side domain homes.
- Do not add new deep-import dependencies from `pi-fleet-extension` into `fleet-core/src/**`; use public exports.
- When splitting mixed modules, move the pure/domain half into `fleet-core` and keep only the Pi adapter half in `pi-fleet-extension`.
- Intermediate re-export shims are a migration artifact only; do not treat them as long-term architecture.

## Invariants

- `api/PUBLIC_API.md` is the frozen public API contract for the productization migration.
- Provider MCP FIFO, token isolation, pre-queue, and HTTP-hold behavior are invariants.
- Preserve existing `globalThis` compatibility keys exactly unless a higher-order doctrine explicitly changes them.
- Background paths must accept plain runtime data and host ports, never Pi `ExtensionContext`.
- Job archive behavior remains read-many within TTL.
