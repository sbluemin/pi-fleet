# unified-agent-core

PI API 의존성 **없는** 순수 SDK. `@sbluemin/unified-agent`를 래핑하여 커넥션/세션/실행을 관리한다.

## 핵심 규칙

- **`index.ts` 생성 금지** — pi가 확장으로 인식하지 않도록
- `ExtensionAPI`, `ExtensionContext`, `@mariozechner/pi-*` import 금지
- 세션 관리는 `executeWithPool` 내부에 완전 캡슐화 — `ExecuteOptions`에 `sessionId` 필드 없음
- 설정 파일(`selected-models.json`, `session-maps/`)이 이 디렉토리에 저장됨 (모든 확장이 공유)

## 모듈 구조

| 파일 | 역할 |
|------|------|
| `types.ts` | 공용 타입 (PI 무관) |
| `client-pool.ts` | 싱글턴 클라이언트 풀 |
| `session-map.ts` | pi 세션 ↔ CLI 세션 매핑 |
| `model-config.ts` | 모델 선택 CRUD, `buildConnectOptions` |
| `executor.ts` | `executeWithPool`, `executeOneShot` |
