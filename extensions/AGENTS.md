# Pi Extensions 개발 지침

이 디렉토리는 pi-coding-agent의 커스텀 extension들을 모아 관리하는 곳이다.
`~/.pi/agent/extensions` → 이 디렉토리로 심볼릭 링크되어 있어 pi 실행 시 자동 로드된다.

## 디렉토리 구조 및 도메인 규칙

### 확장 (Extension) — `index.ts`가 있는 디렉토리

pi가 자동 로드하는 확장 단위. 각 확장은 **독자적인 UI 기능을 제공**해야 한다.
TUI 공식 API(`setWidget`, `setFooter`, `setEditorComponent` 등)를 단순히 래핑하는 중간 레이어는 만들지 않는다.

| 확장 | 역할 | 주요 파일 |
|------|------|-----------|
| `hud-editor/` | 커스텀 에디터 + 상태바 + footer | `index.ts` (배선), `editor.ts` (에디터/footer/위젯 UI) |
| `hud-welcome/` | 웰컴 오버레이/헤더 | `index.ts` (배선), `welcome.ts` (UI), `types.ts` (globalThis 타입) |
| `unified-agent-direct/` | 다이렉트 모드 4종 (alt+1~4) | `index.ts` (배선), `agent-panel.ts`, `agent-panel-renderer.ts` 등 |
| `unified-agent-tools/` | 개별 에이전트 도구 (claude/codex/gemini) | `index.ts` (배선), `renderer.ts` (스트리밍 위젯) |
| `utils-improve-prompt/` | 메타 프롬프팅 (alt+shift+m) | `index.ts` (배선), `ui.ts` (상태바 위젯) |
| `utils-summarize/` | 세션 한 줄 자동 요약 | `index.ts` (배선), `ui.ts` (상태바 위젯) |

### 공유 라이브러리 — `index.ts`가 없는 디렉토리

pi가 확장으로 인식하지 않는 순수 라이브러리.

| 라이브러리 | 역할 | 주요 소비자 |
|-----------|------|------------|
| `hud-core/` | 상태바 렌더링 엔진 (세그먼트, 레이아웃, 색상, 테마, 프리셋) | `hud-editor`, `hud-welcome` |
| `unified-agent-core/` | 통합 에이전트 공유 로직 | `unified-agent-direct` |

### 확장 분리 기준

새 확장을 만들거나 기존 확장을 분리할 때 이 기준을 적용한다:

1. **자체 UI 기능을 제공하는가?** — 독자적인 렌더링 로직, 자체 컴포넌트, 독립 기능이 있으면 **확장으로 분리**
2. **TUI API를 래핑하는 수준인가?** — `setWidget`/`setFooter` 등의 라우팅/중계 역할이면 **분리하지 않고 소비자 확장에 인라인**
3. **여러 확장이 공유하는 순수 로직인가?** — `index.ts` 없는 **공유 라이브러리 디렉토리**로 분리

## 모듈화 원칙

- **`index.ts`는 배선(wiring)만** — `registerTool`, `registerCommand`, `on`, `registerShortcut` 호출과 import만 둔다. 비즈니스 로직, UI 코드를 인라인하지 않는다.
- **UI/렌더링은 반드시 별도 파일로 분리** — `ui.ts`, `editor.ts`, `welcome.ts` 등. `index.ts`에 TUI 컴포넌트 조립 코드를 넣지 않는다.
- **상수/타입은 `types.ts`로 분리** — 여러 모듈에서 공유되는 값(특히 globalThis 키/브릿지 인터페이스)은 반드시 별도 파일.
- **`globalThis`는 "독자적 기능의 액션/데이터 공유"에만 사용** — 확장이 자신의 기능을 다른 확장에 노출할 때만 사용한다 (예: welcome의 dismiss 액션). TUI 데이터를 중계하기 위한 globalThis는 사용하지 않는다.

### globalThis 사용 규칙

```
허용: hud-welcome → globalThis["__pi_hud_welcome__"] = { dismiss }
      (독자적 기능의 액션을 노출)

금지: hud-footer → globalThis["__pi_hud_footer__"] = { footerDataRef, tuiRef }
      (TUI 프레임워크 데이터를 중계하는 래핑)
```

globalThis 키와 브릿지 인터페이스는 **해당 기능을 소유한 확장의 `types.ts`에 정의**한다 (공유 라이브러리가 아닌 소유자 확장에).

## Extension 작성 가이드

### 기본 구조

```
extensions/
├── AGENTS.md
├── <extension-name>/
│   └── index.ts          ← 진입점 (필수)
├── <extension-name>/
│   ├── index.ts
│   ├── ui.ts             ← UI/렌더링 분리
│   └── types.ts          ← 타입/상수
└── <shared-lib>/         ← index.ts 없음 = 확장이 아닌 순수 라이브러리
    ├── types.ts
    └── utils.ts
```

### 규칙

- **각 extension은 반드시 서브디렉토리 + `index.ts` 형태**로 만든다.
- 루트에 `.ts` 파일을 두지 않는다 — pi가 extension으로 인식해버린다.
- `index.ts`는 `(pi: ExtensionAPI) => void` 형태의 default export 함수를 가진다.

### 기본 템플릿

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => { ... });
  pi.registerTool({ name: "...", ... });
  pi.registerCommand("name", { ... });
}
```

### 사용 가능한 import

| 패키지 | 용도 |
|--------|------|
| `@mariozechner/pi-coding-agent` | Extension 타입 (`ExtensionAPI`, `ExtensionContext` 등) |
| `@sinclair/typebox` | 도구 파라미터 스키마 정의 (`Type.Object`, `Type.String` 등) |
| `@mariozechner/pi-ai` | AI 유틸리티 (`StringEnum` — Google API 호환 enum) |
| `@mariozechner/pi-tui` | TUI 컴포넌트 (커스텀 렌더링) |

이들은 pi 런타임이 자동 제공하므로 별도 `npm install` 불필요.
외부 npm 패키지가 필요하면 해당 extension 서브디렉토리에 `package.json`을 두고 `npm install`한다.

### 주의사항

- string enum은 반드시 `StringEnum` (`@mariozechner/pi-ai`)을 사용한다. `Type.Union`/`Type.Literal`은 Google API에서 동작하지 않는다.
- 도구 출력은 **50KB / 2000줄** 제한을 지킨다. 초과 시 `truncateHead`/`truncateTail` 유틸리티를 사용한다.
- 에러는 `throw new Error()`로 시그널링한다 (return으로는 `isError`가 설정되지 않음).

## 주요 API 패턴 레퍼런스

### 메시지 전송

| 메서드 | 용도 | 에이전트 트리거 |
|--------|------|----------------|
| `pi.sendUserMessage(text)` | 사용자 메시지로 에이전트에 전송 (에이전트가 응답함) | **Yes** |
| `pi.sendMessage({...})` | 커스텀 메시지를 TUI에 표시만 함 | **No** (기본값) |

#### `pi.sendUserMessage()` — 에이전트에 전달

```typescript
// 기본 (idle 상태에서만 동작)
pi.sendUserMessage("분석해줘");

// 에이전트가 응답 중일 때 즉시 전송
pi.sendUserMessage("방향을 바꿔줘", { deliverAs: "steer" });

// 현재 턴 완료 후 큐에 대기
pi.sendUserMessage("다음 작업", { deliverAs: "followUp" });
```

#### `pi.sendMessage()` — TUI에 표시만 (에이전트 미트리거)

```typescript
pi.sendMessage({
  customType: "my-result",    // 커스텀 식별자
  content: "표시할 텍스트",     // string 또는 (TextContent | ImageContent)[]
  display: true,              // true여야 TUI에 표시됨
  details: { /* 선택적 메타데이터 */ },
});
// triggerTurn 옵션을 true로 주면 에이전트도 트리거 가능
```

### LLM 호출 (`complete`)

```typescript
import { complete } from "@mariozechner/pi-ai";

// ctx.model로 현재 세션 모델 사용
const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
const response = await complete(
  ctx.model,
  { systemPrompt: "...", messages: [{ role: "user", content: "...", timestamp: Date.now() }] },
  { apiKey }
);

// 응답 텍스트 추출
const text = response.content
  .filter((c): c is { type: "text"; text: string } => c.type === "text")
  .map((c) => c.text)
  .join("\n");
```

### UI 알림

```typescript
ctx.ui.notify("메시지", "info");     // "info" | "warning" | "error"
```

## 개발 워크플로

1. 새 extension: `mkdir <name> && touch <name>/index.ts`
2. 테스트: `pi -e ./<name>/index.ts` (단독) 또는 그냥 `pi` 실행 (전체 로드)
3. 수정 후 반영: pi 내에서 `/reload` (재시작 불필요)
4. 비활성화: 디렉토리명 앞에 `_` 붙이기 (예: `_memo/`) — pi는 `index.ts`가 있는 디렉토리만 로드

## 참고 문서

### 로컬 경로 (AI Agent가 직접 읽을 수 있음)

pi 설치 루트 확인 명령어:

```bash
npm ls -g @mariozechner/pi-coding-agent --parseable 2>/dev/null | head -1
```

| 문서 | 경로 (pi 설치 루트 기준) | 설명 |
|------|--------------------------|------|
| **Extension 전체 문서** | `docs/extensions.md` | API, 이벤트, 도구 등록, 커스텀 UI 등 전체 레퍼런스 |
| **예제 목록 (README)** | `examples/extensions/README.md` | 모든 예제 extension 카탈로그 |
| **TUI 컴포넌트** | `docs/tui.md` | 커스텀 렌더링, 컴포넌트 API |
| **세션 관리** | `docs/session.md` | SessionManager, 상태 저장/복원, 브랜치 |
| **커스텀 프로바이더** | `docs/custom-provider.md` | 모델 프로바이더 등록, OAuth, 스트리밍 |
| **모델 설정** | `docs/models.md` | 모델 추가/커스텀 설정 |
| **테마** | `docs/themes.md` | 테마 커스터마이징 |
| **키바인딩** | `docs/keybindings.md` | 단축키 등록, 기본 키바인딩 |
| **패키지 배포** | `docs/packages.md` | npm/git으로 extension 배포 |
| **Skills** | `docs/skills.md` | Skill 시스템 |
| **설정** | `docs/settings.md` | settings.json 옵션 |
| **SDK** | `docs/sdk.md` | 프로그래밍 방식으로 pi 사용 |
| **RPC** | `docs/rpc.md` | RPC 프로토콜, extension UI sub-protocol |

### 예제 Extension (자주 참고하는 패턴)

경로: `examples/extensions/` (pi 설치 루트 기준)

| 파일 | 패턴 |
|------|------|
| `hello.ts` | 최소 커스텀 도구 |
| `todo.ts` | 상태 저장/복원 + 커스텀 렌더링 + 명령 |
| `tools.ts` | 커스텀 UI (SettingsList) + 세션 퍼시스턴스 |
| `permission-gate.ts` | tool_call 이벤트 차단 |
| `dynamic-tools.ts` | 런타임 도구 등록/해제 |
| `tool-override.ts` | 빌트인 도구 오버라이드 |
| `truncated-tool.ts` | 출력 truncation 처리 |
| `ssh.ts` | 원격 실행 (pluggable operations) |
| `custom-footer.ts` | 커스텀 footer UI |
| `message-renderer.ts` | 커스텀 메시지 렌더링 |
| `with-deps/` | npm 의존성이 있는 extension |
| `subagent/` | 서브에이전트 위임 |

### GitHub

- 모노레포: https://github.com/badlogic/pi-mono
- Extension 문서: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
- Extension 예제: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions
- 빌트인 도구 구현: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/src/core/tools
