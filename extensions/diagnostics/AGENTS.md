# diagnostics

MCP transport 계층의 장기 실행 검증을 위한 전용 진단 도구 모음 확장.

## 활성 조건

- 환경변수 `PI_DIAGNOSTICS_ENABLED=1`일 때만 활성화된다.
- 미설정 시 전체 확장은 정상 no-op로 조기 반환한다.

## 현재 수록 도구

- `dummy_arith_delayed` — 630,000ms 지연 후 산술 결과를 반환하며, Claude Code/Codex/Gemini CLI의 undici `bodyTimeout` 재현 용도로 사용한다.

## Verification Logs (CVN-08 Chronicle)

| Date | Target Tool | Input (a, b, op) | Result | Status | Notes |
|------|-------------|------------------|--------|--------|-------|
| 2026-04-23 | `dummy_arith_delayed` | 1, 1, add | 2 | Pass | Initial baseline verification of the long-running diagnostic tool. |

## 개발 이력

- 원래 `core/dummy-arith/`에 있었던 도구를, core 기본 부트 경로와 분리하기 위해 독립 `diagnostics/` 확장으로 이동했다.
