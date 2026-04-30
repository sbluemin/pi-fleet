# fleet-wiki Doctrine

`packages/fleet-wiki` is a leaf workspace package dedicated to the LLM-Wiki domain. It owns the memory store, briefing, dry-dock, patch queue/ingest tool builder, safety policy, and path resolution.

## Owns

- Pure LLM-Wiki domain logic and types under `src/`
- Single public subpath `./`
- LLM-Wiki package-specific validation under `tests/`

## Must Not Own

- Imports of `@sbluemin/fleet-core` or other workspace packages
- Imports of `@mariozechner/pi-*` or `@anthropic-ai/*`
- Pi runtime wiring, UI registration, or host-specific adapter code

## Dependency Rules

- The only allowed runtime dependency is `@sinclair/typebox`.
- Workspace package imports are strictly forbidden.
- Maintain leaf package doctrine and avoid circular dependencies.

## Compatibility Doctrine

- Preserve the `experimentalWiki` symbol key name for downstream compatibility.
- Do not change MCP tool names: `wiki_briefing`, `wiki_drydock`, `wiki_ingest`, and `wiki_patch_queue`.
- Forbid refactoring, signature changes, or adding new interfaces beyond the extraction objective.
