# shipyard/carrier_jobs

Meta-tool for managing and inspecting asynchronous carrier jobs.

## Doctrine

- **Single Entry Point**: `carrier_jobs` is the only way for agents to interact with detached jobs after they have been accepted.
- **Read-once Result**: Full execution results (logs/thought) are stored in `JobStreamArchive` and can be read exactly once. After reading, the archive entry is invalidated to save memory.
- **Read-many Summary**: LLM-friendly job summaries are cached in an LRU store with a 3-hour TTL, allowing multiple status checks without consuming the full result.
- **Finalized Only**: `result` lookup is only permitted for jobs in a terminal state (`done`, `error`, `aborted`). Attempting to read results of `active` jobs must be rejected.
- **ID-based Context**: Agents must use the `job_id` returned by sortie/squadron/taskforce tools to query status or results.
- **Quiet Rendering by Default**: `carrier_jobs` tool calls render as a quiet one-line summary by default. Detailed rendering is shown only when `/fleet:jobs:verbose` enables Verbose mode.
- **Process-Level Verbose State**: Verbose mode is process-local and non-persistent. Extension reload or process restart returns to Quiet mode.

## Tool Commands

| Command | Description |
|---------|-------------|
| `list` | List recent jobs with their current status and job IDs. |
| `status` | Get the current state and summary of a specific `job_id`. |
| `result` | Retrieve the full execution trace and result content (read-once). |
| `cancel` | Request abortion of an active job. |

## Rules

- **Strict Schema**: All responses must follow the defined `CarrierJobsResult` structure.
- **Redaction**: Ensure that the `result` command returns redacted content as stored in the archive.
- **Status Priority**: Report job status using the priority `aborted > error > done`.
