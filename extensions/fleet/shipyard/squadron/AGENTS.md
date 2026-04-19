# fleet/shipyard/squadron

Carrier Squadron logic for parallel execution of same-type carriers.

## Core Rules

- **Parallel Execution**: A Squadron groups multiple instances of the same carrier type to process sub-tasks in parallel.
- **One-Shot Only**: Squadrons always use `executeOneShot`. They do not maintain persistent sessions or history, making them ideal for fire-and-forget task distribution.
- **Sortie Exclusion**: When a carrier has `squadronEnabled: true`, it is automatically excluded from the standard `carriers_sortie` tool to prevent session/state conflicts.
- **Instance Cap**: Enforces a hard limit of **5 concurrent instances** to prevent resource exhaustion.
- **Tool Synthesis**: Squadron tools are dynamically synthesized based on the underlying carrier's prompt guidelines and capabilities.

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point. Handles squadron tool registration and lifecycle. |
| `squadron.ts` | Main execution engine. Manages `runAgentRequest` calls for squadron instances, synthesizes prompts, and aggregates results. |
| `prompts.ts` | `SQUADRON_MANIFEST` (`ToolPromptManifest`) 정의 및 등록. 도구 교리의 SSOT. |
| `types.ts` | Domain types for squadron configuration and execution state. |

## Execution Flow

1. **Trigger**: PI calls the synthesized squadron tool (e.g., `squadron_athena`).
2. **Decomposition**: `squadron.ts` receives the task and prepares up to 5 parallel requests.
3. **Execution**: Each request is routed through `operation-runner.ts` using `executeOneShot: true`.
4. **Aggregation**: Results from all instances are collected, formatted, and returned to the caller as a unified response.
5. **UI**: Progress is tracked via the same streaming infrastructure, with active status indicated by the `[SQ]` tag in the Status Bar.
