# fleet-core Doctrine

- `packages/fleet-core` is Pi-agnostic product core code.
- Do not import `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@mariozechner/pi-ai`, or `@anthropic-ai/*`.
- Public consumers must use the root barrel or documented package subpaths only.
- `api/PUBLIC_API.md` is the frozen public API contract for the productization migration.
- Provider MCP FIFO, token isolation, pre-queue, and HTTP-hold behavior are invariants.
- Preserve all existing `globalThis` compatibility keys exactly.
- Background paths must accept plain runtime data and host ports, never Pi `ExtensionContext`.
- Job archive behavior is read-many within TTL.
