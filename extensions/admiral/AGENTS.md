# admiral

Admiral **prompt policy** extension — system prompt injection, worldview toggle, and settings section ownership.

This extension is **independent** of `fleet/` and `carriers/`. It depends only on `core/settings` (infrastructure layer).

## Responsibilities

| Responsibility | Implementation |
|----------------|----------------|
| System prompt injection (`before_agent_start`) | `index.ts` — appends Admiral directives and optional worldview prompt |
| Worldview toggle command | `index.ts` — `fleet:admiral:worldview` command |
| Settings section ("Admiral") | `index.ts` — registers in Alt+/ popup, owns `admiral` settings key |
| Prompt constants & settings logic | `prompts.ts` — worldview/system append + `request_directive` 가이드라인 + settings read/write |

## Settings

The settings key is `admiral.worldview`.

## Module Structure

| File | Role |
|------|------|
| `index.ts` | Entry point (wiring only) — `before_agent_start` hook, command registration, settings section, tool registration |
| `prompts.ts` | Prompt constants (`FLEET_WORLDVIEW_PROMPT`, `ADMIRAL_SYSTEM_APPEND`, `REQUEST_DIRECTIVE_PROMPT`) + settings read/write |
| `request-directive.ts` | `request_directive` tool — Fleet Admiral에게 전략적 지시를 요청하는 TUI 도구 (`ctx.ui.custom()` 기반) |

## Tools

| Tool | Description |
|------|-------------|
| `request_directive` | Fleet Admiral(사용자)에게 전략적 지시를 요청. 1-4개 질문, 각 2-4개 선택지 + 직접 입력. multiSelect, 탭 네비게이션 지원. preview는 단일 선택에서만 허용되며 질문/선택지 중복은 거부된다. |

## Core Rules

- **No direct dependency on `fleet/` or `carriers/`** — admiral operates independently.
- **Dependency direction**: `admiral/` → `core/` only.
- **Command naming**: follows `fleet:<domain>:<feature>` form — `fleet:admiral:worldview`.
- **Prompt text lives in `prompts.ts`** — worldview/system append와 `request_directive` 가이드 모두 `prompts.ts`에 둔다.
- **Settings key is `admiral`** — not `fleet`.
