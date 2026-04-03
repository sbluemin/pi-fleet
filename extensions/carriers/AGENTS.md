# carriers

**Independent carrier registration extension** — defines individual carriers (genesis, arbiter, crucible, sentinel, raven, vanguard, echelon, chronicle, oracle) as a standalone, optional extension.

## Role

This extension is responsible solely for **registering carrier instances** with the carrier framework SDK (`shipyard/carrier/`). Each carrier defines its own persona, prompt metadata, and slot assignment.

- This extension is **optional** — users may omit it from `settings.json` if they do not want any carriers.
- Without this extension, the `fleet/` extension still functions (framework SDK, Agent Panel, unified pipeline) but has no registered carriers.

## Architecture

```
carriers/
├── AGENTS.md          ← This file
├── index.ts           ← Extension entry point (wiring only — imports and registers all carriers)
├── genesis.ts         ← CVN-01 Chief Engineer (Claude Code)
├── arbiter.ts         ← CVN-02 Chief Doctrine Officer (Claude Code) ← slot 3
├── crucible.ts        ← CVN-03 Chief Forgemaster (Codex CLI) ← slot 2
├── sentinel.ts        ← CVN-04 The Inquisitor (Codex CLI)
├── raven.ts           ← CVN-05 Red Team Commander (Codex CLI)
├── vanguard.ts        ← CVN-06 Scout Specialist (Gemini CLI)
├── echelon.ts         ← CVN-07 Chief Intelligence Officer (Gemini CLI)
├── chronicle.ts       ← CVN-08 Chief Knowledge Officer (Gemini CLI)
└── oracle.ts          ← CVN-09 Read-Only Strategic Technical Advisor (Claude Code)
```

## Dependency Rules

### Allowed Imports

| Source | Allowed Target | Notes |
|--------|---------------|-------|
| `carriers/*` | `fleet/shipyard/carrier/` | Framework SDK — `registerSingleCarrier`, `CarrierConfig`, types |
| `carriers/*` | `@mariozechner/pi-coding-agent` | Extension API types |
| `carriers/*` | `@sinclair/typebox` | Schema definitions (if needed) |

### Forbidden Imports

| Source | Forbidden Target | Reason |
|--------|-----------------|--------|
| `carriers/*` | `fleet/index.ts` | carriers는 fleet 확장에 의존하지 않음 — framework SDK만 사용 |
| `carriers/*` | `fleet/internal/*` | fleet 내부 구현은 carriers의 관심사가 아님 |
| `carriers/*` | `fleet/operation-runner.ts` | 실행 파이프라인은 framework SDK를 통해 간접 접근 |
| `carriers/*` | `dock/*`, `tender/*` | 다른 확장 레이어에 대한 직접 의존 금지 |
| `fleet/*` | `carriers/*` | fleet 코어는 carriers를 알지 못함 (역방향 의존 금지) |

### Summary

```
carriers/  →  fleet/shipyard/carrier/ (framework SDK only)
                    ✗ fleet/index.ts
                    ✗ fleet/internal/
                    ✗ dock/, tender/
```

## Core Rules

- **`index.ts`는 wiring 전용** — carrier 파일들을 import하고 등록만 수행. 비즈니스 로직 금지.
- **각 carrier 파일은 독립적** — 자체 persona, prompt metadata, slot을 정의. carrier 간 상호 import 금지.
- **Prompt text는 각 carrier 파일에 귀속** — carrier별 역할 분화를 허용하기 위해 의도적으로 prompt를 각 carrier 파일에 유지. `prompts.ts`로 통합하지 않음 (이 규칙은 `extensions/AGENTS.md`의 prompts.ts 기본 규칙에 대한 명시적 예외).
- **Slot은 전체 carrier 중 고유해야 함** — `CarrierConfig.slot` 값이 중복되면 keybinding 충돌 발생.

## Slash Commands

이 확장에서 등록하는 slash command는 `fleet:carrier:` 도메인을 사용한다.

| Command | Description |
|---------|-------------|
| (향후 필요 시 추가) | |
