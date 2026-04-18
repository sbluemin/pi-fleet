# boot

Fleet 확장의 부팅을 제어하는 부트스트래퍼 확장.

PI 로더의 알파벳 순 발견 순서를 이용하여 fleet/, grand-fleet/보다 먼저 로드되며,
`PI_GRAND_FLEET_ROLE=admiralty`일 때 fleet/ 확장을 비활성화한다.

## 부팅 매트릭스

| PI_GRAND_FLEET_ROLE | fleet/ | grand-fleet/ |
|---------------------|--------|--------------|
| admiralty           | 비활성 | 활성 (Admiralty 모드) |
| fleet               | 활성   | 활성 (Fleet 모드) |
| 미설정              | 활성   | 비활성* |

*미설정 시 grand-fleet/은 자체적으로도 역할 미감지로 조기 반환한다.

## Core Rules

- **의존성 없음** — core/, fleet/, grand-fleet/에서 아무것도 임포트하지 않는다.
- **globalThis 컨벤션** — 키 `__fleet_boot_config__`로 부팅 설정 공유. fleet/은 타입 임포트 없이 문자열 키로 직접 읽는다.
- **로드 순서 의존** — 디렉토리 이름 `boot`가 알파벳 순으로 `core`, `fleet`, `grand-fleet`보다 앞에 위치해야 한다.
