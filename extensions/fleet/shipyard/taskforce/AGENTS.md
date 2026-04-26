# shipyard/taskforce

Carrier Task Force management for cross-backend parallel validation.

## Doctrine

- **Cross-Backend Validation**: Executes the same task across all configured CLI backends (≥2) for a specific carrier simultaneously.
- **Persona Preservation**: Applies the chosen carrier's persona and prompt context to all backend calls.
- **Consensus Building**: Used to compare approaches, detect model-specific blind spots, and build consensus across different LLM providers.
- **Detached Execution**: Returns a single `job_id` for the entire task force batch and exits immediately.
- **Labelled Results**: Results arrive via `[carrier:result]` push, with each backend's output clearly labelled (e.g., [Claude], [Codex], [Gemini]).

## Tool Manifest

- **TASKFORCE_MANIFEST**: Defines the `carrier_taskforce` tool prompt and schema.
- **Operational Guidelines**: Manifest instructs the Admiral to use Task Force when cross-model validation or multi-perspective analysis is required.

## Rules

- **Sortie Activation Check**: Rejects the request if the target carrier has its sortie manually disabled (`sortie off`).
- **Busy Check**: Rejects the request if the target carrier is already busy.
- **Backend Requirement**: Requires at least 2 configured backends to execute.
- **Result Labels**: Each execution result must be tagged with its source backend name for the Admiral's interpretation.
