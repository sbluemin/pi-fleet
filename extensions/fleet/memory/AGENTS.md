# Fleet Memory

## Scope

- 이 디렉터리는 Fleet Memory 내부 모듈 전용입니다.
- slash command 도메인은 항상 `fleet:memory:*` 입니다.
- 저장소 루트는 항상 워크스페이스 로컬 `<cwd>/.fleet-memory/` 입니다.

## Allowed Imports

- `@mariozechner/pi-coding-agent`
- `@sinclair/typebox`
- `@mariozechner/pi-ai`
- Node 표준 라이브러리
- 예외적으로 Admiral tool prompt manifest API만 허용합니다.

## Forbidden Imports

- `fleet/bridge/`
- `fleet/admiral/`의 일반 로직
- `fleet/carriers/`
- `fleet/shipyard/`
- `fleet/operation-runner.ts`
- `fleet/pi-tools.ts`
- `fleet/pi-commands.ts`
- `fleet/pi-events.ts`
- `core/agentclientprotocol/`

## Rules

- wiki 대상 patch는 반드시 queue와 human approval을 거칩니다.
- `append_log`만 명시적 인자 게이트 하에서 auto-apply 될 수 있습니다.
- reject는 wiki/log를 절대 변경하지 않습니다.
- AI-facing 문자열은 반드시 `prompts.ts`에 둡니다.
