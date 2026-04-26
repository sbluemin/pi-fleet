---
id: "fleet-memory-prototype-implementation"
title: "Fleet Memory prototype implementation summary"
tags: ["fleet-memory", "prototype", "implementation", "pi-tools"]
created: "2026-04-26T08:17:43.975Z"
updated: "2026-04-26T08:17:43.975Z"
version: 1
---
# Fleet Memory prototype implementation summary

This page records the current prototype shape created during the Fleet Memory session.

## Placement

Fleet Memory is implemented as an internal `extensions/fleet/memory/` module and is wired from the fleet extension startup path.

## Workspace-local store model

The prototype uses a lazy-created `.fleet-memory/` workspace store with separate areas for:

- `raw`: immutable captured source material.
- `wiki`: approved markdown knowledge pages.
- `schema`: memory doctrine and structural metadata.
- `log`: append-only operational records and AARs.
- `queue`: proposed memory patches awaiting approval or rejection.
- `archive`: rejected or applied patch records and AAR audit copies.
- `conflicts`: conflict records and future repair/audit state.
- `index.json`: deterministic index metadata.

## PI tools

The prototype exposes these Fleet Memory tools:

- `memory_ingest`: capture raw source and propose a wiki patch.
- `memory_briefing`: deterministic wiki briefing lookup by id, tag, title, or body.
- `memory_aar_propose`: propose or append an AAR/log entry.
- `memory_drydock`: run static integrity and safety inspection.
- `memory_patch_queue`: list, show, approve, or reject queued patches.

## Slash commands

The prototype exposes these command names:

- `fleet:memory:status`
- `fleet:memory:queue`
- `fleet:memory:show`
- `fleet:memory:approve`
- `fleet:memory:reject`
- `fleet:memory:drydock`

## Behavioral contract

- Ingest captures raw source separately from wiki pages.
- Wiki changes are proposed as patches and are not merged until approval.
- Rejected patches are archived without mutating wiki/log state.
- AARs can be proposed, or explicitly auto-applied as append-only log entries.
- Memory tools use unique prompt manifest tags to avoid registration collisions.
- Store creation is lazy so normal startup/import does not create `.fleet-memory` by accident.

raw_source_ref: raw/2026-04-26-fleet-memory-prototype-implementation-source.md