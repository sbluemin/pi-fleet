---
id: "fleet-core-runtime-context-shape-source"
created: "2026-04-30T17:59:31.228Z"
sourceType: "inline"
title: "2~3차 cleansing — public surface 슬림화"
tags: ["fleet-core", "public-api", "doctrine", "invariant"]
---
Final state after 5 rounds of destructive cleansing (rounds 1–5):
- Round 1: services/agent/ directory deleted, Fleet* wrappers eliminated
- Round 2: public/agent-services.ts deleted, FleetCoreRuntimeContext.agent removed
- Round 3: public/tool-registry-services.ts deleted, .toolRegistry/.mcp fields removed, McpServer external lifecycle blocked
- Round 4: pi-side tool-snapshot.ts deleted, single-store invariant established
- Round 5: fleet.tools made lazy getter (carrier registration timing fix)

Verification: 4 packages type-check exit 0, workspace build exit 0, 383/383 workspace tests green, ACP CLI MCP tools/list e2e verified by 대원수.

Reference docs: api/PUBLIC_API.md (current contract), .fleet/notes/PR-destructive-cleansing.md, .fleet/notes/MIGRATION-services-agent-cleansing.md, CHANGELOG.md [Unreleased].