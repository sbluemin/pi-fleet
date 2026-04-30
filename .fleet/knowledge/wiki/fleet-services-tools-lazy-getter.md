---
id: "fleet-services-tools-lazy-getter"
title: "FleetServices.tools must be a lazy getter"
tags: ["fleet-core", "fleet-services", "invariant", "mcp", "tool-spec"]
created: "2026-04-30T17:57:54.360Z"
updated: "2026-04-30T17:57:54.360Z"
version: 1
rawSourceRef: "raw/2026-04-30-fleet-services-tools-lazy-getter-source.md"
---
## Invariant

`FleetServices.tools` (in `packages/fleet-core/src/public/fleet-services.ts`) MUST be exposed as a lazy getter that re-evaluates `buildFleetToolSpecs(ports)` on every access. It MUST NOT be a frozen array set at `createFleetServices(ports)` time.

```ts
// CORRECT
get tools(): readonly AgentToolSpec[] {
  return buildFleetToolSpecs(ports);
}

// WRONG (carrier registry is empty at this moment)
tools: buildFleetToolSpecs(ports),
```

## Why

`buildFleetToolSpecs(ports)` calls `buildSortieToolSpec(ports)`, `buildSquadronToolSpec(ports)`, and `buildTaskForceToolSpec(ports)`. Each of these inspects the carrier registry via `getRegisteredOrder()` (defined in `packages/fleet-core/src/admiral/carrier/framework.ts`) and returns `null` when the registry is empty:

```ts
// admiral/carrier/tool-spec.ts:155-157
export function buildSortieToolSpec(ports): AgentToolSpec | null {
  const allCarriers = getRegisteredOrder();
  if (allCarriers.length < 1) return null;
  ...
}
```

Carrier registration happens in `pi-fleet-extension/src/tool-registry.ts:registerCarrier()` which runs **after** `createFleetCoreRuntime({ dataDir, ports })` returns. If `createFleetServices(ports)` evaluates `tools` immediately, the carrier registry is empty at that moment and only `buildCarrierJobsToolSpec()` (which has no carrier guard) survives — `sortie` / `squadron` / `taskforce` are dropped permanently.

The frozen-array bug manifests as: ACP CLI (Codex / Claude / Gemini) calls MCP `tools/list` and only sees `carrier_jobs`, `wiki_*` — `carriers_sortie`, `carrier_squadron`, `carrier_taskforce` are silently missing. No error, no log.

## How to apply

- Never replace the lazy getter with an eager array — even for "perf" reasons. The getter is cheap (4 build calls, each O(carrierCount)) and only runs when `provider-stream.ts` actually needs `fleet.tools` for `[...PI tools, ...fleet.tools.map(specToTool)]` registration.
- If you add a 5th built-in ToolSpec that has no carrier dependency, it can be safely included in `buildFleetToolSpecs` regardless — but the lazy contract still applies for the carrier-dependent ones.
- After modifying `fleet-services.ts`, always rebuild dist (`pnpm -r build`) and restart any pi process; the running process holds the old dist in memory.

## Verification

E2E check: launch a pi process, register at least one carrier, start an ACP session, inspect MCP `tools/list` — `carriers_sortie`, `carrier_squadron`, `carrier_taskforce` MUST appear alongside `carrier_jobs` and `wiki_*`.