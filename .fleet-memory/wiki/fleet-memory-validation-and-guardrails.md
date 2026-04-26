---
id: "fleet-memory-validation-and-guardrails"
title: "Fleet Memory prototype validation and guardrails"
tags: ["fleet-memory", "validation", "guardrails", "testing", "security"]
created: "2026-04-26T08:17:54.596Z"
updated: "2026-04-26T08:17:54.596Z"
version: 1
---
# Fleet Memory prototype validation and guardrails

This page records validation results, fixed defects, and residual caveats from the Fleet Memory prototype session.

## Validation commands reported during the session

- `npx vitest run extensions/fleet/tests/memory-*.test.ts` passed with 5 files and 19 tests.
- `npx vitest run extensions/fleet/tests/*.test.ts` passed with 22 files and 167 tests.
- `npx tsc -p extensions/fleet/tsconfig.json --noEmit --ignoreDeprecations 6.0` passed.
- `git diff --check` passed.
- `.fleet-memory` remained absent until an explicit memory operation triggered lazy creation.

## Defects caught and fixed

- PI tool `execute` signatures needed to match the SDK call shape.
- Patch body IDs needed sanitization before becoming wiki file paths.
- Memory tool prompt manifest tags needed to be unique to avoid registration collisions.
- Dry-dock wiki link checking needed a two-pass scan so later-defined wiki IDs do not create false broken-link findings.
- Ingest needed secret-like raw source blocking.
- Dry-dock needed prompt-injection-like content warnings.

## Security and safety guardrails

- Raw source capture should block obvious secret/API-key-like values.
- Prompt-injection-like content should be treated as source risk, not as instructions.
- Important wiki knowledge should remain in patch queue until approved.
- Rejected patches should not mutate approved wiki or log records.
- Path traversal through user-provided memory IDs must remain blocked.

## Known caveats

- Sentinel was offline during final review, so formal Sentinel QA/security review was not performed.
- Nimitz review was cancelled because the code changed while the review was pending and became stale.
- Actual PI TUI `/reload` smoke was not run in-session.
- Plain `npx tsc -p extensions/fleet/tsconfig.json --noEmit` still fails due to existing TypeScript 6 deprecation settings (`moduleResolution=node10`, `baseUrl`), while the implementation passes with `--ignoreDeprecations 6.0`.

raw_source_ref: raw/2026-04-26-fleet-memory-validation-and-guardrails-source.md