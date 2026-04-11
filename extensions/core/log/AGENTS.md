# log

재사용 가능한 로깅 확장. 다른 확장이 globalThis API를 통해 간편하게 로그를 기록할 수 있다.

## Public API

| File | Description |
|------|-------------|
| `bridge.ts` | 유일한 public API — `getLogAPI()` 함수를 통해 `CoreLogAPI` 접근 |
| `types.ts` | 순수 타입 정의 + globalThis 키 상수 (`CORE_LOG_KEY`, `CORE_LOG_FOOTER_KEY`) |

## Footer 표시 방식

`border-bridge.ts`와 동일한 globalThis 간접 통신 + push 렌더 패턴:
1. HUD `setupStatusBar`가 bridge 객체(`{ lines, requestRender }`)에 `requestRender` 콜백 주입
2. log가 `.lines`를 갱신한 뒤(최대 5줄) `.requestRender()`를 호출하여 Footer 즉시 재렌더 (중앙 정렬)
3. 세션 전환(`session_start`) 시 `.lines = null` + `requestRender()`로 stale state 정리
4. 외부 확장 → hud 내부 파일 import 없음 (private 경계 유지)

## Core Rules

- **globalThis 키는 types.ts에 정의** — `CORE_LOG_KEY`, `CORE_LOG_FOOTER_KEY`
- **외부 확장은 `bridge.ts`의 `getLogAPI()` 만 사용** — 내부 모듈 직접 import 금지
- **store.ts, register.ts는 internal** — 이 확장 내부에서만 사용

## Slash Commands

| Command | Description |
|---------|-------------|
| `fleet:log:toggle` | 로그 on/off 토글 |
| `fleet:log:settings` | 상세 설정 (파일 로그, Footer, 최소 레벨, 화면 로그 초기화) |
| `fleet:log:clear` | 로그 전체 삭제 (인메모리 + 파일 로그) |

## Usage (다른 확장에서)

```typescript
import { getLogAPI } from "../log/bridge.js";

const log = getLogAPI();
log.info("my-extension", "초기화 완료");
log.debug("my-extension", `처리된 항목: ${count}`);
```
