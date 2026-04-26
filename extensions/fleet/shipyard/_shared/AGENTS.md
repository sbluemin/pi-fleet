# shipyard/_shared

Internal infrastructure for detached job management, archiving, and caching.

## Doctrine

- **Non-Persistence**: All data in this module (Job Registry, Stream Archive, Summary Cache, Cancel Controllers) is kept in memory only (`globalThis`). No file system persistence is allowed.
- **No ExtensionContext**: Shared detached-job infrastructure must not store or accept admin `ExtensionContext`. Use `ExtensionAPI` only where the push channel explicitly requires `pi.sendMessage`.
- **Carrier Result Push**: Follow-up pushes use `pi.sendMessage` custom messages with `customType: "carrier-result"`, `display: false`, and a `<system-reminder source="carrier-completion">`-wrapped `[carrier:result]` payload. The `source="carrier-completion"` attribute identifies this as a carrier job completion event. Framework push delivery must never be sent as a user-role message.
- **Synchronous Response Doctrine**: Immediate detached-job acceptance text is plain text only. `<system-reminder>` is reserved for the later completion push emitted through `pi.sendMessage`.
- **Process Lifecycle**: Data is lost on process restart/reload. This is intentional to ensure a clean slate and avoid stale job states.
- **Privacy by Design**: `JobStreamArchive` is responsible for redacting sensitive information (secrets, tokens) before storing any trace.
- **Memory Safety**: `JobStreamArchive` and `SummaryCache` use TTL (3h) and capacity limits to prevent memory leaks.

## Infrastructure Components

| Component | Responsibility |
|-----------|----------------|
| `JobRegistry` | Tracks active/finalized job metadata and status. |
| `JobStreamArchive` | Stores full execution traces (thought, text, tool calls). Supports **read-once** invalidation. |
| `SummaryCache` | Stores LLM-friendly summaries for **read-many** access. |
| `CancelRegistry` | Holds AbortControllers for active jobs to support the `cancel` command. |
| `ConcurrencyManager` | Enforces the global cap of 5 concurrent jobs and same-carrier busy checks. |

## Rules

- **Resource Limits**: Enforce `MAX_BLOCKS` and `MAX_TOTAL_BYTES` per job in the archive.
- **Read-Once Invalidation**: Once `JobStreamArchive.read()` is called for a job, its content must be deleted from memory.
- **TTL Enforcement**: Stale entries must be periodically or reactively purged after 3 hours.
- **Pattern Redaction**: Always run the redaction engine on any content entering the archive.
