---
id: "fleet-memory-product-doctrine"
title: "Fleet Memory product doctrine"
tags: ["fleet-memory", "doctrine", "product", "architecture"]
created: "2026-04-26T08:17:32.425Z"
updated: "2026-04-26T08:17:32.425Z"
version: 1
---
# Fleet Memory product doctrine

Fleet Memory is a first-class pi-fleet product feature for accumulating verified operational knowledge that helps the fleet perform future missions better.

## Definition

Fleet Memory preserves raw source as immutable intelligence and turns it into reviewable markdown/wiki knowledge through patch, audit, approval, log, and rollback flows.

## Non-goals

- It is not hidden automatic AI memory.
- It is not vector-DB-first RAG.
- It is not a plain document search feature.
- It does not make unreviewed knowledge authoritative.

## Core doctrine

- Raw source is the source of truth and should not be edited after capture.
- Wiki/chart/brief pages are operational knowledge derived from raw source.
- Schema/doctrine defines how memory may be written, cited, reviewed, and merged.
- Logs record ingest, approval, rejection, rollback, dry-dock findings, and AARs.
- Important wiki knowledge must enter through patch queue and require user-visible approval.
- Context injection must be mission-specific and carrier-specific, not a full memory dump.
- Fleet Memory must remain file-first, observable, reviewable, and rollbackable.

## pi-fleet fit

Fleet Memory matches pi-fleet's Agent Harness model because PI can route memory scouting, drafting, auditing, and review across carrier roles while preserving the Admiral of the Navy's final authority over important knowledge changes.

## Role alignment

- Vanguard maps naturally to source scouting and related-memory search.
- Chronicle maps naturally to wiki, chart, brief, and AAR drafting.
- Sentinel maps naturally to security, source-fidelity, and unsafe-memory review when available.
- Nimitz maps naturally to architectural or doctrinal judgment.
- Genesis and Ohio consume approved context packs during implementation missions.

## Approval rule

A direct ingest should create a patch. Approval should be an explicit action unless the change is low-risk append-only metadata/logging or the user has explicitly authorized merge.

raw_source_ref: raw/2026-04-26-fleet-memory-product-doctrine-source.md