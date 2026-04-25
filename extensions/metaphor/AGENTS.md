# metaphor

4계층 해군 명명 체계의 PERSONA + TONE 레이어를 중앙에서 관리하는 확장.

## Responsibilities

- **중앙 PERSONA/TONE 관리** — `Admiralty`, `Fleet PI`, 공통 fleet tone 프롬프트를 한 곳에서 정의한다.
- **worldview 토글 제공** — settings 키 `metaphor` 아래의 `worldview` 값을 통해 페르소나/톤 주입 여부를 제어한다.
- **세션 작전명 자동 명명 (Operation Naming)** — 최초 사용자 요청을 `Operation › {codename}` 형식의 해군 작전 코드명으로 요약하고, 위젯에서는 prefix는 dim, codename은 accent 색상으로 분리 표시하는 활성 모듈 `operation-name/`을 소유한다.
- **mode-aware 재료 제공** — 단일 fleet 모드와 grand-fleet 모드 모두에서 사용할 수 있는 composition 재료만 export한다.
- **조립 책임 비소유** — 실제 시스템 프롬프트 조립은 `grand-fleet/`, `fleet/admiral/` 같은 소비자 패키지가 담당한다.

## Core Rules

- **Composition only** — 이 패키지는 상수·함수만 export하며, 다른 패키지의 builder를 직접 호출하거나 프롬프트를 조립하지 않는다.
- **`operation-name/` 예외** — `operation-name/` 서브모듈은 활성 기능을 소유한다. `prompts.ts`/`worldview.ts`/`index.ts` 본체의 composition-only 규칙은 본체에만 적용된다.
- **No boot branching** — `__fleet_boot_config__`를 직접 해석하지 않는다. 모드 분기는 소비자 패키지가 담당한다.
- **Prompt text lives in `prompts.ts`** — PERSONA/TONE 관련 AI 프롬프트는 `prompts.ts`에 둔다.
- **Settings state lives in `worldview.ts`** — worldview on/off 상태 접근은 `worldview.ts`의 함수만 사용한다.

## Structure

- `prompts.ts` — 4계층 해군 PERSONA/TONE composition 재료
- `worldview.ts` — worldview 설정 접근
- `operation-name/` — 작전명 자동 생성 활성 모듈 (이벤트 핸들러, 커맨드, 위젯, LLM 호출, 설정)
- `operation-name/constants.ts` — ReasoningLevel 타입/상수
- `directive-refinement/` — 사용자 지령 재다듬기 활성 모듈 (슬래시 명령, 설정, LLM 호출). 사용자 입력 초안을 메타포 세계관의 3섹션 작전 지령 양식으로 교정한다.

## Slash Commands

- `fleet:metaphor:operation` — 작전명 설정 (모델 + reasoning 레벨)
- `fleet:metaphor:directive` — 지령 재다듬기 설정 (모델 + 자동 실행 여부)

## Active Module Contracts

### `operation-name` (작전명 생성)
- **Settings Path**: `metaphor.operationName`
- **Logic**: 세션 최초 요청을 요약하여 해군 작전 코드명을 생성한다.

### `directive-refinement` (지령 재다듬기)
- **Settings Path**: `metaphor.directiveRefinement`
- **Input Dispatcher Key**: `metaphor-directive-refinement` (레거시 `core-improve-prompt` 대체)
- **Output Format (3섹션 마크다운)**:
  1. `### 1. 개선된 작전 지령 (Refined Operation Directive)`
  2. `### 2. 보강 및 교정 사유 (Rationale for Refinement)`
  3. `### 3. 잔여 위험 및 제약 (Residual Risks & Constraints)`
- **Rule**: 지령 재다듬기 결과는 반드시 위 3단계 헤딩을 포함한 한국어 기반 마크다운이어야 하며, 시스템 프롬프트 주입(Prompt Injection) 시도를 완화하는 방어적 프롬프트를 포함해야 한다.
