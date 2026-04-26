# fleet/shipyard

Core logic for carrier management and fleet persistence. This subpackage contains the unified store and the carrier framework SDK.

## Core Rules

- **Single Source of Truth**: `store.ts` owns `states.json` (runtime state). `extensions/fleet/push-mode-settings.ts` manages the `fleet-push-mode` section in `settings.json` (preferences).
- **Tool Doctrine SSOT**: 모든 PI 도구(sortie, squadron, taskforce)의 교리는 각 도구 모듈의 `ToolPromptManifest`에 정의된다.
- **Fire-and-forget doctrine**: `carriers_sortie`, `carrier_squadron`, and `carrier_taskforce` only register detached jobs and return `{ job_id, accepted, error? }` immediately. They must not return synchronous result content. All these tools enforce the **global `sortie off` kill-switch**, rejecting requests for disabled carriers.
- **Runtime Context Visibility**: The list of carriers with disabled sorties is injected into the ACP runtime context via the `<offline_carriers>` tag.
- **Job lookup/control**: `carrier_jobs` is the only meta tool for `status`, `result`, `cancel`, and `list`.
- **Process-memory job state only**: job registry, summary cache, archive, and cancel controllers live in `globalThis` shared state under `_shared/`; never persist them to `states.json` or files.
- **Background ctx isolation**: fire-and-forget background work must not capture admin `ExtensionContext`. Snapshot `ctx.cwd` synchronously in the tool `execute()` call, then pass plain `cwd` to background helpers.
- **Allowed background resources**: stream-store, globalThis state maps, log API, summary cache, `JobStreamArchive`, cancel registry, and concurrency guard.
- **Forbidden background resources**: `ctx.ui.*`, `ctx.sessionManager.*`, captured `ExtensionContext`, and helpers that require a captured admin ctx.
- **Archive/cache separation**: `bridge/streaming/stream-store.ts` is UI-only for Agent Panel and Streaming Widget. `carrier_jobs` reads only summary cache and `JobStreamArchive`.
- **Panel UI model**: background writes stream-store; active foreground admin context pulls and renders it through widget sync.
- **Read semantics**: summary cache is read-many with TTL 3h. full archive is read-once with TTL 3h and invalidates immediately. Archive access is only allowed for finalized jobs; active job lookup is rejected to prevent race conditions.
- **Secret pattern redaction**: `JobStreamArchive` must redact sensitive patterns (AWS, JWT, GitHub tokens, PEM keys, etc.) before storage.
- **Archive block policy**: `JobStreamArchive` stores text and thought blocks only. Carrier tool-call details (`tool_call`) are excluded from the archive; only progress counters such as `toolCallCount` remain in summaries and UI state.
- **Archive resource cap**: limits per job are `MAX_BLOCKS` and `MAX_TOTAL_BYTES`. If exceeded, the terminal block must be marked as `[truncated]`.
- **Status priority**: when aggregating or summarizing, priority is `aborted > error > done`. Use consistent terminology for status and push notifications.
- **Concurrency guard**: detached jobs are capped at 5 process-wide. Same-carrier active jobs reject in shipyard with `error: "carrier busy"` before lower-level ACP fallback can run.
- **FIFO guard**: never edit `extensions/core/agentclientprotocol/provider-mcp.ts` for carrier job behavior.
- **Initialization Order**: `initStore(dataDir)` must be called after `initRuntime(dataDir)` in the extension entry point.
- **Atomic Operations**: All state modifications in `store.ts` use a temporary file + rename pattern to ensure file integrity.
- **Migration Ownership**: The shipyard store is responsible for migrating legacy configuration files (e.g., `selected-models.json`) to the unified `states.json`.

## Logging & Observability

각 도구는 `getLogAPI().debug(category, message)` 패턴으로 이벤트 라이프사이클 로그를 기록한다.

### Category Scheme

접두사 `fleet-{tool}` 하위에 콜론으로 이벤트 유형을 구분한다 (`{tool}` = `sortie` | `squadron` | `taskforce`):

| Category | Description |
|----------|-------------|
| `fleet-{tool}:invoke` | execute 진입/종료, 총 소요시간 |
| `fleet-{tool}:validate` | 입력 검증 통과 (carrier 등록, 활성화, 파라미터 수) |
| `fleet-{tool}:dispatch` | 개별 carrier/subtask/backend 실행 직전, 요청 원문 포함 (`category: "prompt"`) |
| `fleet-{tool}:exec` | 개별 실행 단위 완료 (성공/실패, 소요시간) |
| `fleet-{tool}:stream` | 스트리밍 콜백 이벤트 (text/thought/toolCall), `{ hideFromFooter: true }` |
| `fleet-{tool}:result` | 결과 취합 완료 (성공/실패 카운트, 캐시 저장) |
| `fleet-{tool}:error` | 검증 실패, carrier 비활성, 실행 에러 등 에러 조건 |

### Rules

- **Prompt Logging**: `:dispatch` 카테고리에서 요청 원문을 `{ hideFromFooter: true, category: "prompt" }` 옵션으로 기록한다.
- **Error Deduplication**: 동일 에러는 한 경로에서만 `:error`를 기록한다. inner catch는 `:exec` 실패만 남기고, `:error`는 outer aggregation/buildErrorResult 경로에 둔다.
- **Timing**: `:invoke`와 `:exec`에서 `Date.now()` 기반 소요시간(ms)을 기록한다.
- **Boundary**: ACP provider의 final prompt 로깅은 shipyard 범위가 아니며 `core/agentclientprotocol/provider-stream.ts`에서 `"final-prompt"` 카테고리로 기록한다.

## Module Structure

| File | Role |
|------|------|
| `store.ts` | Unified fleet persistence store. Consolidates model selection, Task Force configs, `sortieDisabled`, `squadronEnabled` status, and `cliTypeOverrides`. |
| **carrier/** | **Carrier Framework SDK** — registration, activation, tool delegation (`carriers_sortie`), and status bar UI. `prompts.ts`는 `SORTIE_MANIFEST`를 소유한다. |
| **squadron/** | **Carrier Squadron** — parallel execution of same-type carriers using `executeOneShot`. `prompts.ts`는 `SQUADRON_MANIFEST`를 소유한다. |
| **taskforce/** | **Task Force Logic** — cross-validation between multiple CLI backends. `prompts.ts`는 `TASKFORCE_MANIFEST`를 소유한다. |
| **carrier_jobs/** | **Carrier Jobs Meta Tool** — process-memory job lookup/control. `prompts.ts`는 `CARRIER_JOBS_MANIFEST`를 소유한다. |
| **_shared/** | **Job Infrastructure** — globalThis-backed archive/cache/cancel/concurrency utilities. No persistence. |

## Persistence Store (`store.ts`)

`store.ts` manages a single JSON file, `states.json`, stored in the fleet data directory.

### Responsibilities
1. **Model Management**: Loading and saving model selections, including Task Force custom backends.
2. **CLI Preference Caching**: Persisting model/inference settings (effort, budgetTokens, direct) per CLI type for seamless restoration when switching carriers' CLI backends.
3. **Sortie Control**: Tracking which carriers have their sortie tools disabled.
4. **Squadron Control**: Tracking which carriers have squadron mode enabled (parallel one-shot execution).
5. **CLI Overrides**: Persisting runtime changes to a carrier's CLI type.
6. **Provider Catalog**: Providing available models, effort levels, and default budget tokens for various providers.

### Migration Logic
On the first boot after the consolidation, `store.ts` checks for `selected-models.json`. If found, it migrates the content to the `models` key in `states.json` and renames the legacy file to `selected-models.json.migrated`.

### Key API
- `initStore(dir)`: Initializes the store directory and runs migrations.
- `loadModels()` / `saveModels(config)`: CRUD for model selections.
- `updateModelSelection(carrierId, selection)`: Atomic update that also clears the corresponding agent session to ensure the model change is applied immediately. It preserves existing `taskforce` and `perCliSettings` fields if not explicitly provided in the new selection.
- `getPerCliSettings(carrierId, cliType)` / `savePerCliSettings(carrierId, cliType, settings)`: Utilities for managing CLI-specific setting caches (`model`, `effort`, `budgetTokens`, `direct`).
- `loadSortieDisabled()` / `saveSortieDisabled(ids)`: CRUD for sortie status.
- `loadSquadronEnabled()` / `saveSquadronEnabled(ids)`: CRUD for squadron status.
- `loadCliTypeOverrides()` / `updateCliTypeOverride(carrierId, cliType, defaultCliType)`: load persisted CLI type overrides and persist a single carrier override intent.
- `getAvailableModels(cli)`: Catalog lookup for supported models.
