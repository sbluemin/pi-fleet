# unified-agent-core

Pure SDK **without** any PI API dependencies. Wraps `@sbluemin/unified-agent` to manage connections/sessions/execution.

## Core Rules

- **Do NOT create `index.ts`** — To prevent pi from recognizing it as an extension.
- Do NOT import `ExtensionAPI`, `ExtensionContext`, or `@mariozechner/pi-*`.
- Session management is fully encapsulated within `executeWithPool` — `ExecuteOptions` does not have a `sessionId` field.
- Configuration files (`selected-models.json`, `session-maps/`) are stored in this directory (shared across all extensions).

## Module Structure

| File | Role |
|------|------|
| `types.ts` | Shared types (PI independent) |
| `client-pool.ts` | Singleton client pool |
| `session-map.ts` | pi session ↔ CLI session mapping |
| `model-config.ts` | Model selection CRUD, `buildConnectOptions` |
| `executor.ts` | `executeWithPool`, `executeOneShot` |
