---
id: "tool-snapshot-single-store-invariant-source"
created: "2026-04-30T17:58:58.444Z"
sourceType: "inline"
title: "4차 cleansing — pi 측 tool-snapshot 이중 정의 폐기"
tags: ["fleet-core", "pi-fleet-extension", "tool-snapshot", "mcp", "invariant", "trap"]
---
Round 4 incident, 대원수 진단:
"@packages/pi-fleet-extension/src/agent/provider-internal/에서 'fleet-core'에 자동 생성되는 MCP의 도구들이 UnifiedAgent에 등록이 되지 않는것 같음."

Vanguard recon revealed two separate globalThis stores:
- packages/pi-fleet-extension/src/agent/provider-internal/tool-snapshot.ts (pi-local, separate STORE_KEY)
- packages/fleet-core/src/services/tool-registry/tool-snapshot.ts (the only one MCP reads)

Resolution path (옵션 A 채택):
1. Delete pi-local tool-snapshot.ts entirely.
2. Add registerTools/getTools/getToolNames/removeTools/clearAllTools/computeToolHash to FleetServices.mcp.
3. provider-stream.ts uses fleet.mcp.X and unions [PI tools, fleet.tools.map(specToTool)].

Verified: 383/383 tests + e2e ACP CLI tool exposure correct after fix.