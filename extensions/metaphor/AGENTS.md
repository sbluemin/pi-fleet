# metaphor

4계층 해군 명명 체계의 PERSONA + TONE 레이어를 중앙에서 관리하는 확장.

## Responsibilities

- **중앙 PERSONA/TONE 관리** — `Admiralty`, `Fleet PI`, 공통 fleet tone 프롬프트를 한 곳에서 정의한다.
- **worldview 토글 제공** — settings 키 `metaphor` 아래의 `worldview` 값을 통해 페르소나/톤 주입 여부를 제어한다.
- **mode-aware 재료 제공** — 단일 fleet 모드와 grand-fleet 모드 모두에서 사용할 수 있는 composition 재료만 export한다.
- **조립 책임 비소유** — 실제 시스템 프롬프트 조립은 `grand-fleet/`, `fleet/admiral/` 같은 소비자 패키지가 담당한다.

## Core Rules

- **Composition only** — 이 패키지는 상수·함수만 export하며, 다른 패키지의 builder를 직접 호출하거나 프롬프트를 조립하지 않는다.
- **No boot branching** — `__fleet_boot_config__`를 직접 해석하지 않는다. 모드 분기는 소비자 패키지가 담당한다.
- **Prompt text lives in `prompts.ts`** — PERSONA/TONE 관련 AI 프롬프트는 `prompts.ts`에 둔다.
- **Settings state lives in `worldview.ts`** — worldview on/off 상태 접근은 `worldview.ts`의 함수만 사용한다.
