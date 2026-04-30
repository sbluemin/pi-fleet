---
id: "fleet-services-tools-lazy-getter-source"
created: "2026-04-30T17:57:54.360Z"
sourceType: "inline"
title: "5라운드 cleansing — fleet.tools lazy getter 결정"
tags: ["fleet-core", "fleet-services", "invariant", "mcp", "tool-spec"]
---
Round 5 of the destructive cleansing operation discovered this bug:

User report: "MCP에는 carrier_jobs, wiki_briefing, wiki_drydock, wiki_ingest, wiki_patch_queue 5개만 등록됨. carriers_sortie, carrier_squadron, carrier_taskforce 도구가 MCP에 등록이 안됨."

Root cause grep:
- packages/fleet-core/src/public/fleet-services.ts:72 (pre-fix): `tools: buildFleetToolSpecs(ports),` — eager evaluation
- packages/fleet-core/src/admiral/carrier/tool-spec.ts:155-157: `if (allCarriers.length < 1) return null`
- packages/fleet-core/src/admiral/carrier/framework.ts:108: `export function getRegisteredOrder(): string[] { return [...getState().registeredOrder]; }` (globalThis singleton)

Fix applied (5라운드):
```ts
get tools(): readonly AgentToolSpec[] {
  return buildFleetToolSpecs(ports);
}
```

Verified by rebuilding dist and restarting pi — sortie/squadron/taskforce normally exposed via MCP tools/list.