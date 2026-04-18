# grand-fleet

복수 PI 인스턴스를 수평 확장하는 Grand Fleet extension. Admiralty(지휘소)가 JSON-RPC over Unix Domain Socket으로 여러 Fleet(함대)를 통솔한다.

## Role

환경변수 `PI_GRAND_FLEET_ROLE`에 따라 2가지 모드로 동작:
- **admiralty**: 지휘소 모드 — JSON-RPC 서버 기동, 함대 관리, 시스템 프롬프트 전체 교체
- **fleet**: 함대 모드 — JSON-RPC 클라이언트로 Admiralty에 접속, Grand Fleet Context 프롬프트 append
- **미설정**: 아무 동작 없음 (기존 단일 함대 모드)

## 2계층 아키텍처

### Core Primitive Layer (범용 기반)
환경변수만으로 동작하는 범용 메커니즘. Formation Strategy와 무관하게 독립 동작.
- IPC 서버/클라이언트 (ipc/)
- 함대 레지스트리 (admiralty/fleet-registry.ts)
- 시스템 프롬프트 분기 (prompts.ts)
- 도구 등록 (admiralty/tools.ts)

### Deployment Runtime Layer (배치 런타임)
Admiralty가 직접 Fleet를 파견할 때 사용하는 실행 레이어.
- Admiralty 수명주기와 IPC 서버 일원화 (admiralty/register.ts)
- tmux 통합 (formation/tmux.ts)
- MCP deploy 도구 (admiralty/tools.ts)

## Domain Boundary Rules

```
grand-fleet/  →  core/ (임포트 허용)
                 ✗ fleet/
                 ✗ fleet/admiral/
                 ✗ fleet/carriers/
```

- `grand-fleet/` → `core/` 임포트만 허용
- `grand-fleet/` → `fleet/`, `fleet/admiral/`, `fleet/carriers/` 임포트 **금지**
- 다른 extension → `grand-fleet/` 임포트 **금지**

## Environment Variables

| 변수 | 설명 | Admiralty | Fleet |
|------|------|-----------|-------|
| `PI_GRAND_FLEET_ROLE` | 역할 지정 | `admiralty` | `fleet` |
| `PI_FLEET_ID` | 함대 식별자 | (불필요) | 필수 |
| `PI_FLEET_DESIGNATION` | 함대 표시명 | (불필요) | 선택/권장 |
| `PI_GRAND_FLEET_SOCK` | 소켓 경로 | (자동 생성) | 필수 |

## File Map

| File | Role |
|------|------|
| `index.ts` | 엔트리포인트 — 환경변수 분기 + globalThis 초기화 |
| `types.ts` | 공용 타입, 상수, globalThis 키 |
| `prompts.ts` | Admiralty + Fleet 시스템 프롬프트 |
| `ipc/protocol.ts` | ndJSON 프레이밍 + 파싱 |
| `ipc/server.ts` | Admiralty JSON-RPC 서버 |
| `ipc/client.ts` | Fleet JSON-RPC 클라이언트 |
| `ipc/methods.ts` | 메서드 핸들러 |
| `admiralty/register.ts` | Admiralty 모드 와이어링 |
| `admiralty/tools.ts` | grand_fleet_deploy / dispatch / broadcast / status 도구 |
| `admiralty/fleet-registry.ts` | 함대 등록/해제/상태 관리 |
| `admiralty/report-renderer.ts` | 함대 보고서 TUI 렌더링 |
| `admiralty/status-overlay.ts` | Admiralty 상황판 오버레이 (Alt+G) |
| `admiralty/roster-widget.ts` | Admiralty 함대 로스터 위젯 |
| `fleet/register.ts` | Fleet 모드 와이어링 + Carrier 상태 수집/전송 |
| `fleet/status-overlay.ts` | Fleet 상황판 오버레이 (Alt+G) |
| `fleet/reporter.ts` | 작전 보고 모듈 |
| `overlay-frame.ts` | 오버레이 프레임 공용 유틸 (border, truncation) |
| `text-sanitize.ts` | ANSI/제어문자 제거 유틸 |
| `formation/tmux.ts` | tmux CLI 래퍼 |

## Core Rules

- **부팅 제어** — `boot/` 확장의 `__fleet_boot_config__` globalThis 플래그로 로드 여부 결정. 역할 미설정 시 grand-fleet 전체가 비활성화된다.
- **역할별 도구/커맨드 격리** — Admiralty 도구(`grand_fleet_deploy`, `dispatch`, `broadcast`, `status`)는 `admiralty` 역할에서만 등록. Fleet 모드에서는 `connect`/`disconnect` 커맨드만 등록.
- **프롬프트 수준 격리** — Admiralty 모드에서 `before_agent_start`로 시스템 프롬프트를 전체 교체. Fleet 모드에서는 연결 상태일 때만 Grand Fleet Context를 append.
- **하이브리드 접속** — Fleet 모드에서 `PI_GRAND_FLEET_SOCK` env var가 있으면 자동 접속, 없으면 `/fleet:grand-fleet:connect`로 수동 접속.
- **Prompt text lives in `prompts.ts`** — AI 프롬프트는 `prompts.ts`에 분리.
- **globalThis로 모듈 간 상태 공유** — 세션 전환에도 유지.
- **`index.ts` is for wiring only** — 비즈니스 로직은 하위 모듈에.
- **슬래시 커맨드**: `fleet:grand-fleet:<feature>` 형식.
- **키바인딩** — `Alt+G`: Grand Fleet Status 오버레이. 역할에 따라 Admiralty/Fleet 뷰를 자동 분기.
- **외부 입력 정화** — 오버레이/위젯에서 렌더링되는 외부 문자열(fleet ID, zone, mission objective 등)은 반드시 `stripControlChars()`로 ANSI/제어문자를 제거한 후 렌더링. Carrier task 텍스트는 `sanitizeTaskText()`로 민감 토큰 마스킹 + 80자 절단.
