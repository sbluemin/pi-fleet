# Changelog

## [Unreleased]
- **Breaking**: `Alt+1~9` 개별 캐리어 단축키 완전 제거
- **Feature**: 인라인 슬롯 내비게이션 도입
  - `Alt+H / Alt+L`: Fleet Bridge 패널 내에서 좌/우 슬롯으로 커서 이동
  - `Ctrl+Enter`: 현재 커서 위치의 Carrier를 독점(Exclusive) 모드로 즉시 활성화
- **UX**: 커서 위치 슬롯에 시각적 하이라이트(`▸` 접두사 + 강조색) 추가
- unified-agent-status 기능을 unified-agent-direct 내부 status 하위 패키지로 합치고, footer에 각 CLI 상태를 인라인으로 표시하도록 정리
- 기본 기능 추가
