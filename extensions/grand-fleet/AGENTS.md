# grand-fleet

복수 PI 인스턴스를 수평 확장하는 Grand Fleet extension. Admiralty(지휘소)가 JSON-RPC over Unix Domain Socket으로 여러 Fleet(함대)를 통솔하고, 최상위 사용자 계층은 Admiral of the Navy (대원수)다.

## Role

환경변수 `PI_GRAND_FLEET_ROLE`에 따라 2가지 모드로 동작:
- **admiralty**: 지휘소 모드 — JSON-RPC 서버 기동, 함대 관리, 시스템 프롬프트 전체 교체 (Fleet Admiral 페르소나)
- **fleet**: 함대 모드 — JSON-RPC 클라이언트로 Admiralty에 접속, Grand Fleet Context 프롬프트 append (Admiral 제독 페르소나)
- **미설정**: 아무 동작 없음 (기존 단일 함대 모드)

## 4-Tier Naval Hierarchy (4계층 해군 위계)

Grand Fleet 도입과 함께 체화된 4단계 위계 구조입니다:

| Tier | Entity | Persona / Target | Role |
|------|--------|-----------------|------|
| 1 | **Admiral of the Navy (ATN, 대원수)** | **사용자 (User)** | 최종 전략 수립 및 함대 가동의 주체. |
| 2 | **Fleet Admiral (사령관)** | **Admiralty LLM 페르소나** | `grand-fleet`의 지휘소(Admiralty)를 의인화한 지휘관. 다수 함대 조율. |
| 3 | **Admiral (제독)** | **개별 PI 인스턴스 (Host PI)** | 특정 워크스페이스(함대)의 작전 계획 및 Carrier 파견 담당. |
| 4 | **Captain** | **Carrier 에이전트 페르소나** | 개별 Carrier의 지휘관 페르소나 (e.g., Chief Engineer, Scout Specialist). |

> **Note on Persona & Tone**: 모든 계층의 명칭 컨벤션, 의인화 페르소나, 언어적 톤은 `metaphor` 패키지에서 중앙 관리합니다.

### Admiralty (조직) vs Fleet Admiral (사령관)
- **Admiralty**: `grand-fleet`의 **조직 및 시스템 레이어**. 코드 내 `AdmiraltyServer`, `registerAdmiralty` 등의 식별자로 표현되는 물리적 지휘소.
- **Fleet Admiral (사령관)**: Admiralty LLM이 취하는 **지휘관 페르소나**. 사용자(ATN)에게 보고하고 각 함대의 Admiral(제독)들을 지휘하는 목소리.

## 2계층 아키텍처 (Runtime Layer)

시스템의 실행 레이어 구조입니다 (위계 구조와 별개):

### Connectivity Runtime Layer (연결 런타임)
환경변수만으로 동작하는 범용 메커니즘. Formation Strategy와 무관하게 독립 동작.
- IPC 서버/클라이언트 (ipc/)
- 함대 레지스트리 (admiralty/fleet-registry.ts)
- 시스템 프롬프트 분기 (prompts.ts)
- 도구 등록 (admiralty/pi-tools.ts, fleet/pi-tools.ts)

### Deployment Runtime Layer (배치 런타임)
Admiralty가 직접 Fleet를 파견할 때 사용하는 실행 레이어.
- Admiralty 수명주기와 IPC 서버 일원화 (admiralty/pi-events.ts, admiralty/runtime.ts)
- tmux 통합 (formation/tmux.ts)
- MCP deploy 도구 (admiralty/pi-tools.ts)

## Domain Boundary Rules

```
grand-fleet/  →  core/ (임포트 허용)
                 ✗ fleet/
                 ✗ fleet/admiral/
                 ✗ fleet/carriers/
```

- `grand-fleet/` → `core/` 임포트만 허용.
- `grand-fleet/` → `fleet/`, `fleet/admiral/`, `fleet/carriers/` 임포트 **절대 금지**.
- `grand-fleet/`는 `extensions/fleet/**`의 기능을 사용하지 않고 독자적인 `prompts.ts` 조립 솔기(seam)와 `globalThis` 런타임 상태를 통해 동작한다.
- 다른 extension → `grand-fleet/` 임포트 **금지**.

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
| `index.ts` | 엔트리포인트 facade — 환경변수 분기 + globalThis 초기화 + 역할 dispatcher |
| `types.ts` | 공용 타입, 상수, globalThis 키, 역할별 runtime state 타입 |
| `prompts.ts` | Admiralty + Fleet 시스템 프롬프트 조립 SSOT (Local Composition Seam) — worldview 상태에 따라 role 변종을 선택 |
| `ipc/protocol.ts` | ndJSON 프레이밍 + 파싱 |
| `ipc/server.ts` | Admiralty JSON-RPC 서버 |
| `ipc/client.ts` | Fleet JSON-RPC 클라이언트 |
| `ipc/methods.ts` | 메서드 핸들러 |
| `admiralty/register.ts` | Admiralty 역할 facade |
| `admiralty/pi-events.ts` | Admiralty `before_agent_start`, `session_start`, `session_shutdown` owner |
| `admiralty/runtime.ts` | Admiralty server, registry, presenter, roster listener disposer owner |
| `admiralty/pi-tools.ts` | grand_fleet_deploy / dispatch / recall / broadcast / status 도구 |
| `admiralty/fleet-registry.ts` | 함대 등록/해제/상태 관리 |
| `admiralty/report-renderer.ts` | 함대 보고서 TUI 렌더링 |
| `admiralty/status-overlay.ts` | Admiralty 상황판 오버레이 (Alt+G) |
| `admiralty/status-overlay-keybind.ts` | Admiralty Alt+G keybind와 popup guard |
| `admiralty/roster-widget.ts` | Admiralty 함대 로스터 위젯 |
| `fleet/register.ts` | Fleet 역할 facade |
| `fleet/pi-events.ts` | Fleet `before_agent_start`, `session_start`, `message_end`, `agent_end`, `session_shutdown` owner |
| `fleet/pi-commands.ts` | `fleet:grand-fleet:connect` / `disconnect` 커맨드 owner |
| `fleet/pi-tools.ts` | `mission_report` 도구 owner |
| `fleet/runtime.ts` | FleetClient, heartbeat/status timers, mission/report buffer owner |
| `fleet/status-source.ts` | Carrier snapshot, fleet ping payload, overlay runtime snapshot 입력 owner |
| `fleet/status-overlay.ts` | Fleet 상황판 오버레이 (Alt+G) |
| `fleet/status-overlay-keybind.ts` | Fleet Alt+G keybind와 popup guard |
| `fleet/reporter.ts` | 작전 보고 모듈 |
| `overlay-frame.ts` | 오버레이 프레임 공용 유틸 (border, truncation) |
| `text-sanitize.ts` | ANSI/제어문자 제거 유틸 |
| `formation/tmux.ts` | tmux CLI 래퍼 |

## Core Rules

### 1. 부팅 및 역할 제어
- `boot/` 확장의 `__fleet_boot_config__` globalThis 플래그로 로드 여부 결정.
- 환경변수 `PI_GRAND_FLEET_ROLE`이 미설정된 경우 grand-fleet 전체가 비활성화된다.
- **index.ts**는 오직 wiring과 dispatcher 역할만 수행하며, 비즈니스 로직은 하위 모듈에 둔다.

### 2. 역할별 자산 격리 (Isolation)
- **도구/커맨드**: Admiralty 전용 도구는 `admiralty/pi-tools.ts`에서, Fleet 전용 커맨드/도구는 `fleet/` 하위에서만 등록한다.
- **이벤트**: `pi.on()` 이벤트 구독 소유권을 역할별 `pi-events.ts`로 명확히 분리한다.
- **키바인딩**: `Alt+G` (Grand Fleet Status) 키바인딩은 Admiralty와 Fleet가 각자의 `status-overlay-keybind.ts`를 통해 독립적으로 등록하며, 팝업 상태(popup guard)도 각자 관리한다.

### 3. 프롬프트 구성 솔기 (Prompt Composition Seam)
- `prompts.ts`는 Admiralty와 Fleet 모두를 위한 프롬프트 조립 SSOT이다.
- `buildFleetAcpSystemPrompt()`는 `extensions/fleet/**`를 임포트하지 않고 독자적으로 Fleet ACP 기본 의미와 Grand Fleet Context를 조립하는 **Local Seam** 역할을 한다.
- Admiralty는 `before_agent_start`에서 시스템 프롬프트를 전체 교체하며, Fleet은 연결 상태일 때만 Context를 append한다.

### 4. globalThis 런타임 버킷 (Runtime Buckets)
세션 전환 시에도 상태를 유지하기 위해 3가지 전역 버킷을 사용한다:
- `GRAND_FLEET_STATE_KEY`: 기본 설정 및 공용 상태 (`GrandFleetState`). 역할, 소켓 경로, 연결된 함대 맵 등.
- `GRAND_FLEET_ADMIRALTY_RUNTIME_KEY`: Admiralty 전용 런타임 핸들 (`AdmiraltyRuntimeState`). IPC 서버, 레지스트리, 디스포저 등.
- `GRAND_FLEET_FLEET_RUNTIME_KEY`: Fleet 전용 런타임 핸들 (`FleetRuntimeState`). IPC 클라이언트, 하트비트 타이머, 미션 텍스트 버퍼 등.

### 5. 데이터 정화 및 안전 (Sanitization)
- 오버레이/위젯 등 TUI에 렌더링되는 모든 외부 문자열(함대 ID, 구역, 미션 목표 등)은 `stripControlChars()`로 ANSI/제어문자를 반드시 제거한다.
- Carrier task 텍스트는 `sanitizeTaskText()`를 통해 민감 토큰 마스킹 및 80자 truncation을 수행한다.

### 6. 슬래시 커맨드 및 커뮤니케이션
- 슬래시 커맨드 형식: `fleet:grand-fleet:<feature>`.
- Admiralty는 직접 파일을 수정하거나 쉘 명령을 실행하지 않으며, 오직 함대 파견(`deploy`), 명령 전달(`dispatch`/`broadcast`), 상태 조회(`status`)만 수행한다.
