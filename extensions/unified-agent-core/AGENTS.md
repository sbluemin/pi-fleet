# unified-agent-core

Pure SDK **without** any PI API dependencies. Wraps `@sbluemin/unified-agent` to manage connections/sessions/execution.

## Core Rules

- **Do NOT create `index.ts`** — To prevent pi from recognizing it as an extension.
- Do NOT import `ExtensionAPI`, `ExtensionContext`, or `@mariozechner/pi-*`.
- Session management is fully encapsulated within `executeWithPool` — `ExecuteOptions` does not have a `sessionId` field. Instead, `sessionStore` (a `SessionMapStore` instance) is passed in, and the executor uses it internally. Callers cannot manipulate sessionId directly.
- All persistent data (`selected-models.json`, session maps) is managed by each extension independently. This SDK provides CRUD/factory APIs — callers decide where to persist via `configDir` and `SessionMapStore`.
- `createSessionMapStore(sessionDir)` provides the session map factory. `loadSelectedModels(configDir)` / `saveSelectedModels(configDir, config)` handle model config I/O.

## Module Structure

| File | Role |
|------|------|
| `types.ts` | Shared types (PI independent) |
| `client-pool.ts` | Singleton client pool |
| `session-map.ts` | `SessionMapStore` factory — instance-based session mapping (no globalThis) |
| `model-config.ts` | Model selection CRUD, `buildConnectOptions` |
| `executor.ts` | `executeWithPool`, `executeOneShot` |
