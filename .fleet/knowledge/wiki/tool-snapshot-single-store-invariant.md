---
id: "tool-snapshot-single-store-invariant"
title: "Tool snapshot store has a single source of truth — never duplicate it in pi-fleet-extension"
tags: ["fleet-core", "pi-fleet-extension", "tool-snapshot", "mcp", "invariant", "trap"]
created: "2026-04-30T17:58:58.444Z"
updated: "2026-04-30T17:58:58.444Z"
version: 1
rawSourceRef: "raw/2026-04-30-tool-snapshot-single-store-invariant-source.md"
---
## Invariant

The tool snapshot globalThis store lives in **one place only**: `packages/fleet-core/src/services/tool-registry/tool-snapshot.ts`. The MCP HTTP server in `admiral/_shared/mcp.ts` reads `getToolsForSession(token)` from that file. All registration paths MUST funnel into that single store via `FleetServices.mcp.registerTools(token, tools)`.

DO NOT recreate a parallel `tool-snapshot.ts` inside `pi-fleet-extension/src/agent/provider-internal/` (or anywhere else). Doing so creates a separate globalThis store, which silently breaks ACP CLI tool exposure: the pi side registers tools that the MCP server cannot see.

## The trap (round 4 incident)

Earlier rounds delegated tool snapshot to a pi-local `provider-internal/tool-snapshot.ts` for "self-contained adapter" reasons. The result:
- pi registered PI tools (Read/Write/Bash/etc.) into the pi-local store.
- The MCP server read from the fleet-core store and saw an empty session — so ACP CLI received zero tools.
- Type-check, build, and unit tests all passed because each store was internally consistent. The bug only manifested at runtime via missing tool exposure.

## Correct registration flow

`packages/pi-fleet-extension/src/agent/provider-internal/provider-stream.ts` MUST do the union registration:

```ts
function specToTool(spec: AgentToolSpec): Tool {
  return {
    name: spec.mcp?.exposeAs ?? spec.name,
    description: spec.description,
    parameters: spec.parameters,
  };
}

const fleetTools = getFleetRuntime().fleet.tools.map(specToTool);
const mcpTools = [...(piTools ?? []), ...fleetTools];
mcpApi().registerTools(sessionToken, mcpTools);
```

Both PI tools (host-provided) and `fleet.tools` (fleet-core auto-registered: sortie/squadron/taskforce/carrier_jobs) MUST be registered together so the ACP CLI sees the union.

## How to apply

- Future maintainers of `provider-internal/`: do NOT extract tool snapshot logic into a "lightweight pi adapter". The wrapper-elimination doctrine of this project explicitly forbids it.
- If a new pi-side tool snapshot need arises (e.g. caching, filtering), extend `FleetServices.mcp` in fleet-core, not pi.
- The single-store doctrine is symmetric for `getToolsForSession` / `getToolNamesForSession` / `removeToolsForSession` / `clearAllTools` / `computeToolHash` — all go through `fleet.mcp.X`.