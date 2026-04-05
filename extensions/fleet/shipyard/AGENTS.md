# fleet/shipyard

Core logic for carrier management and fleet persistence. This subpackage contains the unified store and the carrier framework SDK.

## Core Rules

- **Single Source of Truth**: `store.ts` is the authoritative owner of all fleet persistent state (`states.json`).
- **Initialization Order**: `initStore(dataDir)` must be called after `initRuntime(dataDir)` in the extension entry point.
- **Atomic Operations**: All state modifications in `store.ts` use a temporary file + rename pattern to ensure file integrity.
- **Migration Ownership**: The shipyard store is responsible for migrating legacy configuration files (e.g., `selected-models.json`) to the unified `states.json`.

## Module Structure

| File | Role |
|------|------|
| `store.ts` | Unified fleet persistence store. Consolidates model selection, Task Force configs, `sortieDisabled` status, and `cliTypeOverrides`. |
| **carrier/** | **Carrier Framework SDK** — registration, activation, tool delegation (`carrier_sortie`), and status bar UI. |
| **taskforce/** | **Task Force Logic** — cross-validation between multiple CLI backends. |

## Persistence Store (`store.ts`)

`store.ts` manages a single JSON file, `states.json`, stored in the fleet data directory.

### Responsibilities
1. **Model Management**: Loading and saving model selections, including Task Force custom backends.
2. **CLI Preference Caching**: Persisting model/inference settings (effort, budgetTokens, direct) per CLI type for seamless restoration when switching carriers' CLI backends.
3. **Sortie Control**: Tracking which carriers have their sortie tools disabled.
4. **CLI Overrides**: Persisting runtime changes to a carrier's CLI type.
5. **Provider Catalog**: Providing available models, effort levels, and default budget tokens for various providers.

### Migration Logic
On the first boot after the consolidation, `store.ts` checks for `selected-models.json`. If found, it migrates the content to the `models` key in `states.json` and renames the legacy file to `selected-models.json.migrated`.

### Key API
- `initStore(dir)`: Initializes the store directory and runs migrations.
- `loadModels()` / `saveModels(config)`: CRUD for model selections.
- `updateModelSelection(carrierId, selection)`: Atomic update that also clears the corresponding agent session to ensure the model change is applied immediately. It preserves existing `taskforce` and `perCliSettings` fields if not explicitly provided in the new selection.
- `getPerCliSettings(carrierId, cliType)` / `savePerCliSettings(carrierId, cliType, settings)`: Utilities for managing CLI-specific setting caches (`model`, `effort`, `budgetTokens`, `direct`).
- `loadSortieDisabled()` / `saveSortieDisabled(ids)`: CRUD for sortie status.
- `loadCliTypeOverrides()` / `saveCliTypeOverrides(overrides)`: CRUD for CLI type overrides.
- `getAvailableModels(cli)`: Catalog lookup for supported models.
