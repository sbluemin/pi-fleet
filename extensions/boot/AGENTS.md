# boot

Fleet 확장의 부팅을 제어하는 부트스트래퍼 확장.

PI 로더의 알파벳 순 발견 순서를 이용하여 fleet/, grand-fleet/보다 먼저 로드되며,
`PI_GRAND_FLEET_ROLE=admiralty`일 때 fleet/ 확장을 비활성화한다.
또한 `PI_EXPERIMENTAL=1`일 때 실험적 확장들이 참고하는 `experimental` 플래그를 설정한다.

## 부팅 매트릭스

| 항목 | 값 | 의미 |
|------|----|------|
| PI_GRAND_FLEET_ROLE | admiralty | metaphor/ 활성, fleet/ 비활성, grand-fleet/ 활성 (Admiralty 사령관 모드) |
| PI_GRAND_FLEET_ROLE | fleet | metaphor/ 활성, fleet/ 활성 (제독/함장 모드), grand-fleet/ 활성 (Grand Fleet 연동 모드) |
| PI_GRAND_FLEET_ROLE | 미설정 | metaphor/ 활성, fleet/ 활성 (단일 함대 모드), grand-fleet/ 비활성* |
| PI_EXPERIMENTAL | 1 | `__fleet_boot_config__.experimental = true`; `experimental-*` 확장 활성화 조건 |
| PI_EXPERIMENTAL | 미설정 또는 기타 값 | `__fleet_boot_config__.experimental = false`; `experimental-*` 확장 비활성 |

*미설정 시 grand-fleet/은 자체적으로도 역할 미감지로 조기 반환한다.

## Core Rules

- **의존성 없음** — core/, metaphor/, fleet/, grand-fleet/에서 아무것도 임포트하지 않는다.
- **globalThis 컨벤션** — 키 `__fleet_boot_config__`로 부팅 설정 공유. fleet/은 타입 임포트 없이 문자열 키로 직접 읽는다.
- **experimental 플래그** — `experimental-*` 확장들은 `__fleet_boot_config__.experimental`을 확인해 활성 여부를 결정한다.
- **로드 순서 의존** — 디렉토리 이름 `boot`가 알파벳 순으로 `core`, `diagnostics`, `experimental-*`, `fleet`, `grand-fleet`, `metaphor`보다 앞에 위치해야 한다. (알파벳 순 기준 부팅 시작점: boot → core → diagnostics → experimental-* → fleet → grand-fleet → metaphor)
