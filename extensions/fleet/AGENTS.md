# fleet

Carrier **framework SDK** (`shipyard/carrier/`) + Admiral/Bridge/Carrier wiring + integrated carrier modes and agent tools + model selection + Status Bar + Agent Panel.

The number of carriers is determined at runtime by the carrier modules registered from `fleet/carriers/index.ts`, which is booted by `fleet/index.ts`. Each carrier specifies a `slot` number which determines its panel column position and inline navigation order automatically.

## 4-Tier Naval Hierarchy (4계층 해군 위계)

이 확장은 다음과 같은 4계층 위계에 따라 함대를 제어합니다:

1. **Admiral of the Navy (ATN, 대원수)**: **사용자 (User)**. 함대 운영의 최종 주체.
2. **Fleet Admiral (사령관)**: `grand-fleet`의 Admiralty LLM 페르소나.
3. **Admiral (제독)**: **워크스페이스 PI 인스턴스 (Host PI)**. 작전을 계획하고 Carrier를 파견하는 주체.
4. **Captain (함장)**: 개별 **Carrier 에이전트 페르소나**. 각 함장(e.g., Chief Engineer)은 자신의 Carrier를 지휘하여 **Admiral (제독)**의 지시에 응답합니다.

> **Note on Persona & Tone**: 모든 계층의 명칭 컨벤션, 의인화 페르소나, 언어적 톤은 `metaphor` 패키지에서 중앙 관리합니다.

## Core Rules

- **Carrier vs Captain**: **Carrier**는 시스템 엔티티(실행 인스턴스, 설정)이며, **Captain (함장)**은 그 Carrier를 대변하는 지휘관 페르소나입니다.
- Carrier framework state in `shipyard/carrier/framework.ts` is **shared via `globalThis`** — Avoid module-level singletons as pi bundles each extension separately.
- `registerCarrier` is the public API for carrier registration (re-exported via `index.ts`).
- `registerSingleCarrier` is the convenience API for single CLI carrier registration (re-exported via `index.ts`, lives in `shipyard/carrier/register.ts`). It registers the carrier in the framework with **Captain (함장)** 페르소나 메타데이터를 포함하지만 PI 도구로 직접 등록되지는 않습니다.
- **`Admiral (제독)`**의 전역 지침(SSOT)은 `admiral` 확장에서 관리하며, **PERSONA/TONE 소스는 `metaphor` 패키지를 사용합니다.** 모든 PI 도구(sortie, squadron, taskforce)의 교리는 `ToolPromptManifest`를 통해 동적으로 조립됩니다.
- Calling foreground `runAgentRequest()` **automatically syncs all UIs**: Agent Panel column, Streaming Widget (when panel collapsed), and stream-store data.
- Detached fire-and-forget jobs must call the ctx-free background runner. Background work must not capture admin `ExtensionContext`; it writes stream-store/global job state only and lets the next valid admin tick pull updates into Agent Panel/Streaming Widget.
- **carrierId vs cliType**: `carrierId` (string) is the unique carrier identity used for pool keys, session keys, and panel column identity. `cliType` (CliType) is the CLI binary to execute. Multiple carriers can share the same `cliType` while maintaining fully isolated sessions and connections. **`cliType` can be dynamically changed and persisted at runtime, and `defaultCliType` preserves the original CLI type.**
- **Slot-based ordering**: Each carrier's `slot` determines its panel column position and inline navigation order. Slots must be unique across all registered carriers. **When `cliType` changes, the sorting order and theme color of the corresponding CLI type are immediately reflected.**
- **carriers_sortie call instance isolation**: The `carriers_sortie` tool uses `toolCallId` as the `sortieKey` to isolate state (progress, streaming content, result cache) per call. This prevents UI interference and redundant content output during concurrent/sequential calls.
- **Carrier Squadron (Parallel Execution)**: Same-type carriers can be grouped into a **Squadron** (toggled via 'S' key in Status Overlay) for parallel task processing.
  - **Global Kill-switch**: If a carrier's sortie is manually disabled (`sortie off`), it is **automatically excluded** from all dispatch modes, including `carriers_sortie`, `carrier_squadron`, and `carrier_taskforce`.
  - **Exclusion**: `squadronEnabled` carriers are also excluded from the base `carriers_sortie` tool to prevent session conflicts.
  - **Fire-and-forget**: Squadron jobs are registered as detached jobs and return a `job_id` immediately.
  - A hard cap of **5 concurrent instances** is enforced per squadron.
  - Active squadrons are indicated by a `[SQ]` tag in the Status Bar.
- **Asynchronous Operations & Archiving**: `carriers_sortie`, `carrier_taskforce`, and `carrier_squadron` tools operate in fire-and-forget mode.
  - **Sortie Guard**: All dispatch tools enforce the `sortie off` global kill-switch.
  - **Runtime Context**: The ACP runtime context includes an `<offline_carriers>` tag containing comma-separated IDs of carriers with their sortie disabled, allowing the Admiral to perceive the offline state.
  - **Immediate Response**: Tools return `{ job_id, accepted }` instantly.
  - **Job Stream Archive**: Detached job outputs are stored in a process-memory archive (`JobStreamArchive`).
  - **Limits**: 3-hour TTL (`CARRIER_JOB_TTL_MS`), 8MB/2000-block per job capacity (`MAX_TOTAL_BYTES`, `MAX_BLOCKS`), and a global concurrency cap of 5 detached jobs.
  - **Read-Once Policy**: Full results retrieved via `carrier_jobs` are invalidated after the first read.
- **Job lookup/control**: `carrier_jobs` is the only meta tool for `status`, `result`, `cancel`, and `list` actions. It reads from summary cache and `JobStreamArchive`, not the UI stream-store.
- **Carrier result follow-up push**: framework pushes must use `pi.sendMessage` custom messages with `customType: "carrier-result"` and `display: false` so they wake the Admiral without rendering as user messages in Messages. The LLM context payload remains a `<system-reminder>`-wrapped `[carrier:result]` block. Framework push delivery must never be sent as a user-role message.
- **Panel animation lifecycle**: animation ticks are governed by active Fleet work, not only Admiral streaming. Keep the panel animTimer alive while any detached background job is active, and let widget-sync gracefully skip stale or absent contexts.
- **Dynamic CliType Overrides**: You can change the CLI type of a specific carrier at runtime via `updateCarrierCliType`. The changed state is saved in `states.json` and maintained after restart. **When switching CLI types, the current model, reasoning effort, and budget tokens are cached (`perCliSettings`) and automatically restored when returning to that CLI type (with validation against the new provider's capabilities).**
- **Batch CLI Control**: Supports batch switching of all carriers belonging to a specific CLI type to another type (`Shift+C` in Status Overlay) and restoring all carriers to their source-level default CLI types (`Shift+R` in Status Overlay).
- **Same carrierId concurrent calls are not supported** — UI layer manages one visible run per carrierId.
- The Agent Panel is the main UI for streaming — multi-column is the default, and `Ctrl+Enter` opens a panel-local 1-column detail view for the selected carrier.

## Architecture

### Core / Feature Separation

```
index.ts               ← extension entry point + public Facade re-exports + admiral/bridge/carrier wiring
boot.ts                ← boot guard, data directory, runtime/store/service-status init callback injection, pre-registration restore
boot-reconciliation.ts ← post-carrier-registration model/squadron/taskforce reconciliation
pi-events.ts           ← Fleet-owned PI lifecycle event pipeline; calls explicit Admiral/Bridge feature APIs
pi-tools.ts            ← Fleet PI tool, renderer, and job summary cache registration
pi-commands.ts         ← Fleet-level slash command registration
operation-runner.ts    ← unified execution entry point (internal — exposed via index.ts)
admiral/               ← Admiral prompt-policy library (prompts, protocols, standing-orders, widget, request-directive)
bridge/                ← Integrated Fleet Bridge package (ACP overlay shell + Agent Panel + Carrier UI overlays + Renderer + Streaming store)
  ├── acp-shell/       ← ACP overlay shell (Alt+T)
  ├── carrier-ui/      ← Status Overlay & Carrier UI overlays (Alt+O)
  ├── panel/           ← Agent Panel state & lifecycle (Alt+P)
  ├── streaming/       ← Stream store & domain types
  └── render/          ← Panel rendering engine
carriers/              ← default carrier definitions registered by `carriers/index.ts`, booted from `fleet/index.ts`
shipyard/carrier/      ← Carrier framework SDK + carrier visual representation
  ├── types.ts         ← CarrierConfig, internal state types (오버레이 전용 타입은 bridge/carrier-ui/로 분리)
  ├── framework.ts     ← registerCarrier, updateCarrierCliType, setPendingCliTypeOverrides
  ├── register.ts      ← registerSingleCarrier
  ├── prompts.ts       ← carriers_sortie tool base prompt management
  ├── sortie.ts        ← carriers_sortie ToolDefinition factory + dynamic prompt synthesis
shipyard/squadron/     ← Carrier Squadron logic (parallel one-shot execution)
shipyard/store.ts      ← Unified fleet persistence store (states.json)
```

### Dependency Principles

- **Shared domain types** are distributed to their owning subpackages: `bridge/streaming/types.ts` owns `ColBlock`, `ColStatus`, `CollectedStreamData`; `bridge/panel/types.ts` owns `AgentCol`; `bridge/carrier-ui/types.ts` owns overlay domain types. Common types (`ProviderKey`, `HealthStatus`, `ServiceSnapshot`) are imported directly from **`core/agentclientprotocol/types.ts`**.
- **One-way dependency**: The **`core`** layer (including `core/agentclientprotocol/`) must never reference the **`fleet`** layer. `fleet` → `core` is the only allowed direction.
- **Carrier definitions live under `fleet/carriers/`** and are wired only through `fleet/carriers/index.ts`, which is booted from `fleet/index.ts`. Framework internals (`shipyard/*`, `bridge/panel/*`, `bridge/render/*`, `bridge/streaming/*`) must remain unaware of carrier persona modules.
- **Top-level wiring imports**: `fleet/index.ts` imports `fleet/carriers/index.ts`, `fleet/admiral/index.ts`, and `fleet/bridge/index.ts` for boot wiring. `pi-events.ts` may import explicit event-facing APIs from `admiral/index.ts` and `bridge/index.ts` because it owns the Fleet PI lifecycle event pipeline.
- **Subpackage modules reference siblings directly** — e.g., `bridge/panel/config.ts` imports from `shipyard/carrier/framework.ts` without going through the facade.
- **`index.ts` is the only public facade**: It owns extension wiring plus export-only public re-exports. Keep business logic in `shipyard/carrier/`, `bridge/panel/`, `bridge/render/`, `bridge/streaming/`, `shipyard/squadron/`, and `operation-runner.ts`.
- **Service status lives in core**: Service status monitoring (polling, rendering) lives in **`core/agentclientprotocol/service-status/`**. `boot.ts` injects the Agent Panel service-status callbacks during runtime initialization, and `pi-events.ts` attaches/detaches the active status context during PI lifecycle events.
- **Persistence is dual-layered**:
  - **Core persistence** (`core/agentclientprotocol/runtime.ts`) manages the data directory and **session-only** maps (mapping host PI session IDs to individual carrier session IDs).
  - **Fleet persistence** (`shipyard/store.ts` and `push-mode-settings.ts`) manages two files in `~/.pi/fleet/`:
    - `states.json`: Runtime state including model selection, `sortieDisabled`, `squadronEnabled`, and `cliTypeOverrides`.
    - `settings.json`: Persistent user preferences including `fleet-push-mode` (deliverAs setting).
- `shipyard/store.ts` is the single source of truth for `states.json`. `push-mode-settings.ts` provides the API for the `fleet-push-mode` section in `settings.json`. All writes use atomic patterns to prevent corruption.
- **Boot Order Compliance**: `boot.ts` handles the pre-registration restore, while `boot-reconciliation.ts` handles post-registration state pruning. This separation ensures that persistent overrides (like `cliType`) are applied correctly during carrier registration.

### Unified Execution Pipeline

```
Consumer (carriers, external extensions)
  → runAgentRequest() (operation-runner.ts — exposed via index.ts)
    → stream-store (data)
    → Agent Panel column sync (UI)
    → Streaming Widget when collapsed (UI)
    → executeWithPool (execution)
  → UnifiedAgentResult
```

### Agent Panel Centric Design

- **Detail View**: `Ctrl+Enter` on the selected inline slot → Full-width 1-column panel for the corresponding carrier.
- **Multi-Column View**: Default panel mode — renders the current visible CLI columns.
- **Compact View**: Panel collapsed + while streaming → 1-line Streaming Widget.
- **Frame Color**: Applies `CARRIER_COLORS` of the detail-view carrier. **If `cliType` has changed, the color of the changed type is followed.**

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point + public Facade — boot orchestration, feature registration, dependency injection, export-only public re-exports |
| `boot.ts` | Fleet boot guard, `~/.pi/fleet` data directory resolution, runtime/store/service-status callback initialization, pre-registration state restore |
| `boot-reconciliation.ts` | One-shot post-carrier-registration reconciliation for model selections, stale squadron IDs, and Task Force configured carriers |
| `pi-events.ts` | Fleet-owned `pi.on(...)` registrations and lifecycle event order; calls explicit Admiral/Bridge feature APIs (e.g., `syncAdmiralAcpSystemPrompt`, `ensureBridgeKeybinds`) |
| `pi-tools.ts` | Fleet PI tool, renderer, and job summary cache registration |
| `pi-commands.ts` | Fleet-level slash commands registered at fleet entry, including fleet-owned `fleet:agent:status`, `fleet:jobs:mode`, and shipyard carrier-jobs `fleet:jobs:verbose` |
| `push-mode-settings.ts` | Push delivery mode settings manager (`followUp` vs `steer`). Manages `settings.json` integration and SettingsOverlay registration. |
| `types.ts` | Public types + globalThis bridge key/interface for `requestUnifiedAgent` |
| `constants.ts` | Shared constants (colors, spinners, border characters, panel colors) |
| `bridge/streaming/types.ts` | Streaming domain types — ColBlock, ColStatus, CollectedStreamData |
| `bridge/panel/types.ts` | Panel domain types — AgentCol |
| `bridge/carrier-ui/types.ts` | Overlay domain types — CarrierCliType, ModelSelection, OverlayState, etc. |
| `operation-runner.ts` | Unified execution layer (internal) — `runAgentRequest`, `exposeAgentApi`. Single `executeWithPool` call site. Auto panel/widget sync |
| `shipyard/carrier/types.ts` | Carrier framework types — CarrierConfig, internal state types |
| `shipyard/carrier/framework.ts` | Carrier framework SDK — `registerCarrier`, `updateCarrierCliType`, `setPendingCliTypeOverrides`. Manages globalThis shared state and registration order. |
| `shipyard/carrier/register.ts` | Single-carrier registration — `registerSingleCarrier`. Performs dynamic cliType reference. |
| `shipyard/carrier/prompts.ts` | `SORTIE_MANIFEST` (`ToolPromptManifest`) 소유 |
| `shipyard/carrier/sortie.ts` | Carrier Sortie tool logic — through **call instance isolation (sortieKey)**, it displays unified progress without UI interference. |
| `shipyard/squadron/index.ts` | Squadron module entry point — registration and public API |
| `shipyard/squadron/squadron.ts` | Squadron execution logic — manages parallel `executeOneShot` calls. |
| `shipyard/taskforce/taskforce.ts` | Task Force execution logic — cross-backend parallel `executeOneShot`. |
| `shipyard/squadron/prompts.ts` | `SQUADRON_MANIFEST` (`ToolPromptManifest`) 소유 |
| `shipyard/taskforce/prompts.ts` | `TASKFORCE_MANIFEST` (`ToolPromptManifest`) 소유 |
| `shipyard/carrier_jobs/prompts.ts` | `CARRIER_JOBS_MANIFEST` (`ToolPromptManifest`) 소유 |
| `shipyard/carrier_jobs/jobs.ts` | Carrier Jobs meta tool — `status`, `result`, `cancel`, `list` action dispatcher. |
| `shipyard/_shared/job-stream-archive.ts` | Centralized detached job output archive logic. |
| `shipyard/store.ts` | Unified fleet persistence store (`states.json`). |
| `bridge/carrier-ui/status-overlay-keybind.ts` | Alt+O keybind registration and Status Overlay controller wiring. |
| `bridge/carrier-ui/status-overlay.ts` | Status Overlay UI implementation. |
| `bridge/carrier-ui/status-renderer.ts` | Carrier status segment renderer. |
| `shipyard/carrier/model-ui.ts` | Model selection UI and keybind/command registration. |
| `bridge/panel/state.ts` | Panel global state management. |
| `bridge/acp-shell/*` | ACP overlay shell modules. |
| `bridge/panel/*` | Panel state/lifecycle/widget modules. |
| `bridge/streaming/*` | Stream store and widget modules. |
| `bridge/streaming/direct-chat-session.ts` | Direct-chat-only session persistence on shutdown. |
| `bridge/render/*` | Renderer modules. |
| **core/agentclientprotocol/** | **(Core Infrastructure)** — Provider execution, session maps, MCP bridge. |
| **carriers/** | Default carrier definition library. |
