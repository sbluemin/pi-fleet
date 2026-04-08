# AGENTS.md — @sbluemin/unified-agent

## 프로젝트 개요

Gemini CLI, Claude Code, Codex CLI를 ACP 프로토콜로 통합하는 최소 의존성 지향 TypeScript SDK.

## 기술 스택

- **언어**: TypeScript (ES2022, strict 모드)
- **빌드**: tsup (ESM + CJS 듀얼 출력)
- **테스트**: Vitest
- **런타임 의존성**: `@agentclientprotocol/sdk`, `zod`, `picocolors`
- **Node.js**: >= 18.0.0

## 프로젝트 구조

```
src/
├── index.ts                    # Public exports (SDK 진입점)
├── cli.ts                      # CLI 진입점 (모드 분기: 원샷 vs REPL)
├── cli-oneshot.ts              # 원샷 실행 로직 (CLI 인자 처리 및 실행)
├── cli-repl.ts                 # REPL 모드 로직 (대화형 인터페이스)
├── cli-renderer.ts             # CLI 결과 렌더링 (Pretty/JSON 출력)
├── types/
│   ├── common.ts               # JSON-RPC 2.0 기본 타입
│   ├── acp.ts                  # ACP 프로토콜 타입 (공식 스키마 기반)
│   └── config.ts               # CLI 설정/감지 타입
├── connection/
│   ├── BaseConnection.ts       # 추상 기반 (spawn + JSON-RPC stdio)
│   └── AcpConnection.ts        # ACP 프로토콜 구현 (공식 SDK ClientSideConnection 래핑)
├── client/
│   └── UnifiedAgentClient.ts   # 통합 클라이언트 (최상위 API)
├── detector/
│   └── CliDetector.ts          # CLI 자동 감지
├── models/
│   ├── schemas.ts              # 모델 레지스트리 Zod 스키마 + 타입
│   └── ModelRegistry.ts        # 정적 모델 레지스트리 (models.json 기반)
├── config/
│   └── CliConfigs.ts           # CLI별 spawn 설정
└── utils/
    ├── env.ts                  # 환경변수 정제
    ├── process.ts              # 프로세스 안전 종료
    └── npx.ts                  # npx 경로 해석

tests/
└── e2e/                        # CLI별 E2E 테스트 (실제 CLI 실행)
    ├── helpers.ts              # 공용 헬퍼 함수
    ├── claude.acp.test.ts      # Claude ACP E2E
    ├── codex.acp.test.ts       # Codex ACP E2E
    └── gemini.acp.test.ts      # Gemini ACP E2E
```

## 핵심 명령어

```bash
# 타입 체크
npm run lint

# CLI별 E2E 테스트 (실제 CLI 필요, 로컬에서만)
npx vitest run tests/e2e/claude.acp.test.ts
npx vitest run tests/e2e/codex.acp.test.ts
npx vitest run tests/e2e/gemini.acp.test.ts

# 전체 테스트
npm test

# 빌드
npm run build
```

## CLI (`ait`)

binary 이름: `ait` (`package.json` bin 필드)

```bash
# 원샷 모드 — 인자 있으면 즉시 실행 후 종료
ait "프롬프트"
ait -c claude -m opus "코드 리뷰"
echo "에러" | ait -c gemini

# REPL 모드 — 인자 없이 TTY에서 실행
ait
ait -c claude -m opus
```

### REPL 프롬프트
```
ait (model) (effort) ❯ {입력}
ait (gemini) ❯ {입력}           # effort 미지원 시 생략
```

### 슬래시 커맨드
| 커맨드 | 동작 |
|--------|------|
| `/model <id>` | 모델 변경 (인자 없으면 목록) |
| `/effort <lv>` | reasoning effort 변경 |
| `/status` | 현재 상태 표시 |
| `/clear` | 화면 클리어 |
| `/help` | 도움말 |
| `/exit` | 종료 |

## 코딩 규칙

### 언어
- 모든 코드 주석은 **한국어(한글)** 로 작성합니다.
- JSDoc의 `@param`, `@returns` 설명도 한국어로 작성합니다.

### TypeScript
- `strict: true` — any, implicit any 사용 금지.
- `noUnusedLocals: true`, `noUnusedParameters: true` — 미사용 변수/파라미터 금지.
- import에 `.js` 확장자를 포함합니다 (ESM 호환).
- `as unknown as Record<string, unknown>` 패턴으로 JSON-RPC params 타입 캐스팅합니다.

### 프로토콜
- ACP 타입은 [공식 ACP 스키마](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json) 기준.
- `protocolVersion`은 숫자 (uint16), 현재 `1`.
- `session/new` params: `{ cwd: string, mcpServers: [] }` (필수).
- `session/prompt` params: `{ sessionId, prompt: ContentBlock[] }`.
- `session/set_config_option` params: `{ sessionId, configId, value }`.

### 테스트
- **E2E 테스트** (`tests/e2e/`): CLI별 + 프로토콜별 독립 파일. 실제 CLI를 spawn하므로 인증된 로컬 환경에서만 실행.
- 파일명 규칙: `<cli>.acp.test.ts` (예: `claude.acp.test.ts`, `codex.acp.test.ts`)
- `describe.skipIf(!isCliInstalled('xxx'))` 패턴으로 설치되지 않은 CLI 자동 건너뛰기.
- 테스트 타임아웃: 180,000ms (3분), 세션 재개: 360,000ms (6분).

### 의존성
- **런타임 의존성 최소화**: `@agentclientprotocol/sdk`(공식 ACP SDK) + `zod`(스키마 검증) + `picocolors`(CLI 전용 스타일링).
- 개발 도구만 devDependencies에 추가: `typescript`, `tsup`, `vitest`, `@types/node`.

## CLI별 ACP 지원 현황

| CLI | 프로토콜 | spawn 방식 | set_config_option | set_mode |
|-----|----------|------------|-------------------|----------|
| Gemini | ACP | `gemini --experimental-acp` | ❌ | ❌ |
| Claude | ACP (npx bridge) | `npx @agentclientprotocol/claude-agent-acp@0.24.2` | ✅ | ✅ |
| Codex | ACP (npx bridge) | `npx @zed-industries/codex-acp@^0.10.0` | ✅ | ✅ |

## 아키텍처 의사결정

1. **ACP 단일 프로토콜**: 모든 CLI를 ACP 프로토콜로 통합. `UnifiedAgentClient`로 추상화.
2. **공식 ACP SDK 기반**: `@agentclientprotocol/sdk`의 `ClientSideConnection`을 래핑하여 프로토콜 통신 위임.
3. **Config-driven**: CLI 차이는 `CliConfigs.ts`의 설정으로 관리. 코드 분기 최소화.
4. **Event-driven Streaming**: `EventEmitter` 기반 실시간 응답 처리 (`messageChunk`, `toolCall` 등).
5. **Graceful Process Management**: 2단계 종료 (SIGTERM → SIGKILL), 환경변수 정제로 자식 프로세스 간섭 방지.
