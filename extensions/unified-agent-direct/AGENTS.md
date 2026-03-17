# unified-agent-direct

다이렉트 모드 **프레임워크** + 4개 CLI(claude/codex/gemini/all) 다이렉트 모드 + 모델 선택 + 상태바 + 에이전트 패널.

## 핵심 규칙

- `framework.ts`의 상태는 **`globalThis`로 공유** — pi가 확장별로 별도 번들링하므로 모듈 레벨 싱글턴 사용 금지
- `registerCustomDirectMode`가 공개 API
- 모드 간 상호 배타는 프레임워크가 자동 관리 (`deactivateAll`)
- 모델 설정(`/ua-models`)은 이 확장에서 관리하며, `notifyStatusUpdate()`로 변경을 알림
- 상태바(`ua-status`)는 모든 CLI의 현재 모델/effort를 표시
- 에이전트 패널은 스트리밍의 주 UI — 개별 CLI는 독점 뷰, All은 3분할 뷰
- 활성 모드에 따라 패널 프레임 색상이 자동 변경

## 아키텍처

### 에이전트 패널 중심 설계

- **기존 보더 위젯 + 애니메이션 제거** → 모든 스트리밍 UI가 에이전트 패널로 통합
- **독점 뷰 (Exclusive)**: alt+1/2/3 → 해당 에이전트 전체 폭 패널 (thinking + tools + response)
- **3분할 뷰 (Full)**: alt+0 → 3개 에이전트 동시 질의, 칼럼별 compact thinking/tools
- **컴팩트 뷰 (Compact)**: 패널 접힘 + 스트리밍 중 → 1줄 상태바
- **프레임 색상**: 활성 모드의 DIRECT_MODE_COLORS 적용 (비활성 시 PANEL_COLOR)

## 모듈 구조

| 파일 | 역할 |
|------|------|
| `index.ts` | 진입점: 4개 CLI 모드 등록(claude/codex/gemini/all), 모델 선택 커맨드, 상태바 |
| `framework.ts` | 공개 API (`registerCustomDirectMode`, `activateMode`, `onStatusUpdate` 등). 모드 전환 시 에이전트 패널 연동 |
| `constants.ts` | 공용 상수 (색상, 스피너, 보더 문자, 패널 색상) |
| `renderers.ts` | 기본 사용자/응답 메시지 렌더러 팩토리 (채팅 히스토리용) |
| `ui-utils.ts` | TUI 유틸 (`makeBorderLine`, `wrapWithSideBorder`, `buildStreamingPreview`) |
| `agent-panel.ts` | 에이전트 패널 상태 관리 + API (`setAgentPanelMode`, `show/hide/toggle`, `startStreaming/stop`, `beginCol/endCol`, `updateCol`) |
| `agent-panel-renderer.ts` | 에이전트 패널 렌더링 (`renderPanelFull` — activeMode에 따라 1칼럼/3칼럼 동적 전환, `renderPanelCompact`), `AgentCol` 타입 |
| `direct-panel-mirror.ts` | 개별 CLI 실행 → 에이전트 패널 칼럼 스트리밍 브릿지 (`createDirectPanelMirror`). thinking/도구 호출/응답 모두 패널에 반영 |
