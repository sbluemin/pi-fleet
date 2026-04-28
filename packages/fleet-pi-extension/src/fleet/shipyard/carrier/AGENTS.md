# shipyard/carrier

Carrier Framework SDK — registration, activation, and tool delegation logic.

## Doctrine

- **Framework-as-a-Service**: This module provides the infrastructure for carriers to exist. It manages the `globalThis` shared state for carrier registrations and ensures singleton-like behavior across separately bundled extension instances.
- **Detached Sortie**: The `carriers_sortie` tool is strictly fire-and-forget. It accepts a task, registers a background job, and returns `{ job_id, accepted: true }` immediately.
- **Call Instance Isolation**: Each `carriers_sortie` call is isolated by `toolCallId` (acting as `sortieKey`). This prevents UI interference when multiple agents call the same carrier or different carriers simultaneously.
- **RunId-based Filtering**: Streaming output is filtered by `runId` to ensure the Agent Panel and Streaming Widget only show relevant progress for the current execution.
- **Messages summary only**: `carriers_sortie` renderCall is a fixed 1-line summary; legacy `SortieCallComponent` live tree rendering has been removed.
- **Agent Panel is the only live streaming channel**: live sortie output must flow through stream-store + Agent Panel, not Messages.

## Tool Manifest

- **SORTIE_MANIFEST**: Defines the `carriers_sortie` tool. It resides in `prompts.ts` and acts as the SSOT for the tool's schema and behavioral guidelines.
- **Operational Guidance**: The manifest must instruct the Admiral to use `carrier_jobs` for result inspection and status monitoring, as results are not returned synchronously.

## Rules

- **Busy Rejection**: Before dispatching a new sortie, the framework must check `globalThis` for existing active jobs for the specific `carrierId`. If busy, it must return an error immediately to prevent session corruption.
- **Registration Pipeline**:
  - `registerCarrier()`: The primary API for registering full carrier configs.
  - `registerSingleCarrier()`: A convenience wrapper for CLI-based carriers, handling automatic `defaultCliType` assignment and persona metadata.
- **Activation & Visibility**: The `sortie off` state acts as a **global kill-switch** for a carrier. Disabled carriers must be filtered out from the prompt lists of all dispatch tools (`carriers_sortie`, `carrier_squadron`, `carrier_taskforce`) and are rejected at the dispatch entry point.
- **CLI Type Fluidity**: Supports runtime `cliType` overrides. When a carrier's CLI type changes, its associated theme colors and sorting order in the UI must update immediately.

## Module Structure

- `index.ts`: Public Facade for the carrier framework.
- `framework.ts`: Core registration and state management logic using `globalThis`.
- `register.ts`: Single-carrier registration helper.
- `prompts.ts`: SSOT for `SORTIE_MANIFEST`.
- `sortie.ts`: `carriers_sortie` tool implementation and execution logic.
- `model-ui.ts`: Model selection TUI and keybindings.
