# shipyard/squadron

Carrier Squadron management for parallel execution of same-type carriers.

## Doctrine

- **One-Shot Parallelism**: Executes multiple carriers of the same CLI type in parallel using `executeOneShot`.
- **Atomic Dispatch**: Dispatches all requested carriers as a single unit.
- **Detached Execution**: Following the fleet doctrine, `carrier_squadron` returns a single `job_id` for the entire batch and exits immediately.
- **Aggregation**: Result summaries must aggregate individual carrier outcomes. If any carrier fails, the job status reflects the highest priority error.
- **Agent Panel is the only live streaming channel**: live subtask output is written to stream-store/PanelJob and must not reappear in Messages.
- **Messages renderCall stays compact**: `carrier_squadron` renderCall is a fixed 1-line summary only.

## Tool Manifest

- **SQUADRON_MANIFEST**: Defines the `carrier_squadron` tool prompt and schema.
- **Guidelines**: Squadron tools should be used for tasks that can be broken down into independent subtasks suitable for parallel processing.

## Rules

- **Sortie Activation Check**: Rejects the request if any of the target carriers have their sortie manually disabled (`sortie off`). Uses the same "manually disabled" error message as the base sortie tool.
- **Busy Check**: Rejects the request if any of the target carriers are already busy with an active job.
- **Logging**: Uses `fleet-squadron:*` categories for lifecycle observability.
- **Prompt Composition**: Dynamically builds the prompt for each carrier based on the squadron input.
- **Panel sync path**: background runner writes stream-store blocks, and bridge panel-job adapters pull that state into the Agent Panel automatically.
