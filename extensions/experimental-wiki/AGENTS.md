# experimental-wiki

Experimental **Fleet Wiki** extension — file-first workspace knowledge store, patch queue, and deterministic briefing tools.

## Scope

- 이 디렉터리는 Fleet Wiki 실험 확장 전용입니다.
- 확장은 `PI_EXPERIMENTAL=1`일 때만 활성화됩니다.
- 활성화 여부는 `globalThis["__fleet_boot_config__"].experimental` 문자열 키로만 확인합니다.
- slash command 도메인은 항상 `fleet:wiki:*` 입니다.
- 저장소 루트는 항상 워크스페이스 로컬 `<cwd>/.fleet/knowledge/` 입니다.

## Storage

Fleet Wiki는 `<cwd>/.fleet/knowledge/` 아래에 다음 file-first 구조를 유지합니다.

| Path | Role |
|------|------|
| `raw/` | 원본 source 캡처 |
| `wiki/` | 승인된 markdown wiki entry |
| `schema/` | doctrine/schema 자료 |
| `log/` | append-only AAR/log entry |
| `queue/` | 승인 대기 patch |
| `archive/` | 승인/반려된 patch archive |
| `conflicts/` | 수동 검토가 필요한 conflict record |
| `index.json` | 재생성 가능한 deterministic wiki 색인 |

## Allowed Imports

- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`
- Node 표준 라이브러리

## Forbidden Imports

- `fleet/`
- `metaphor/`
- `core/agentclientprotocol/`
- `extensions/boot/`

## Rules

- AI-facing 문자열은 반드시 `prompts.ts`에 둡니다.
- 도구명은 `wiki_ingest`, `wiki_briefing`, `wiki_aar_propose`, `wiki_drydock`, `wiki_patch_queue` 형식을 사용합니다.
- wiki 대상 patch는 반드시 queue와 human approval을 거칩니다.
- `append_log`만 명시적 인자 게이트 하에서 auto-apply 될 수 있습니다.
- reject는 wiki/log를 절대 변경하지 않습니다.

## Commands

- 단일 진입점: `fleet:wiki:menu` (인터랙티브 오버레이 허브)
- 개별 숏컷 커맨드는 제공하지 않음 — 모든 기능은 허브를 통해 접근
- 신규 기능 추가 시 허브 메뉴에 항목으로 추가
