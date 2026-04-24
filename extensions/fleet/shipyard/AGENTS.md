# fleet/shipyard

Core logic for carrier management and fleet persistence. This subpackage contains the unified store and the carrier framework SDK.

## Core Rules

- **Single Source of Truth**: `store.ts` is the authoritative owner of all fleet persistent state (`states.json`).
- **Tool Doctrine SSOT**: 모든 PI 도구(sortie, squadron, taskforce)의 교리는 각 도구 모듈의 `ToolPromptManifest`에 정의된다.
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
