# PI Development Reference Guide

이 문서는 PI SDK와 이를 활용한 `pi-fleet` 확장 개발을 위한 종합 참조 가이드입니다. PI의 핵심 시스템, UI 컴포넌트, 프롬프트 엔진, 그리고 설정 시스템에 대한 상세 내용을 다룹니다.

---

## 1. PI 설치 경로 동적 조회

PI SDK의 원본 소스나 문서를 확인해야 할 때, 설치 환경에 따라 경로가 다를 수 있습니다. 아래 방법들을 통해 `$PI_ROOT`를 동적으로 조회할 수 있습니다.

### Shell (bash/zsh)
PI CLI가 `PATH`에 등록되어 있는 경우:
```bash
# pi 위치를 기반으로 루트 디렉토리 추출
PI_ROOT=$(dirname $(dirname $(readlink -f $(which pi))))
echo $PI_ROOT  # 예: /Users/sbluemin/workspace/pi-fleet/node_modules/@mariozechner/pi-coding-agent

# 원본 문서 및 소스 열람
ls $PI_ROOT/docs/
open $PI_ROOT/README.md
```

### Node.js (확장 코드 내에서)
확장 프로그램 실행 중에 PI 패키지의 위치를 알아내야 할 경우:
```ts
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const piPackagePath = require.resolve('@mariozechner/pi-coding-agent/package.json');
const piRoot = path.dirname(piPackagePath);
```

### npm global 경로
전역 설치된 경우:
```bash
npm root -g  # 전역 node_modules 위치 확인
# 전역 설치 시 실제 경로: $(npm root -g)/@mariozechner/pi-coding-agent
```

### 이 프로젝트(pi-fleet)의 로컬 경로
`pi-fleet` 저장소에서는 `pi`가 `node_modules`에 로컬 설치되어 관리됩니다.
- **경로:** `./node_modules/@mariozechner/pi-coding-agent/` (저장소 루트 기준)

---

## 2. 원본 문서 색인 (PI SDK Docs)

PI SDK는 상세한 개발 문서를 제공합니다. 상세 구현 방식이 궁금할 경우 `$PI_ROOT/docs/` 아래의 다음 파일들을 참조하십시오.

- **기본 가이드**: `$PI_ROOT/README.md`
- **확장 시스템**: `$PI_ROOT/docs/extensions.md` (확장 등록 및 라이프사이클)
- **SDK 활용**: `$PI_ROOT/docs/sdk.md` (AgentSession, Tool 정의 등)
- **커스텀 프로바이더**: `$PI_ROOT/docs/custom-provider.md` (LLM 연결)
- **모델 설정**: `$PI_ROOT/docs/models.md` (models.json 스키마)
- **TUI 시스템**: `$PI_ROOT/docs/tui.md` (컴포넌트 렌더링 및 입력 처리)
- **테마 시스템**: `$PI_ROOT/docs/themes.md` (색상 토큰 및 커스텀 테마)
- **키바인딩**: `$PI_ROOT/docs/keybindings.md` (단축키 설정)
- **스킬**: `$PI_ROOT/docs/skills.md` (SKILL.md 기반 기능 확장)
- **프롬프트 템플릿**: `$PI_ROOT/docs/prompt-templates.md` (슬래시 명령 템플릿)
- **패키지 관리**: `$PI_ROOT/docs/packages.md` (pi install 및 의존성)
- **설정**: `$PI_ROOT/docs/settings.md` (settings.json 구성)
- **RPC 프로토콜**: `$PI_ROOT/docs/rpc.md` (외부 프로세스 연동)

---

## 3. 확장(Extension) 개발 지침

PI 확장은 에이전트의 기능을 동적으로 추가하는 핵심 단위입니다.

원본 문서: `$PI_ROOT/docs/extensions.md`

### 디렉토리 구조 및 역할 분담
- **`index.ts`**: Wiring 전용. 확장의 구성 요소(Tool, UI, Provider 등)를 등록하는 로직만 포함합니다.
- **UI 파일**: 컴포넌트 정의는 별도 파일로 분리하여 가독성을 높입니다.
- **`prompts.ts`**: AI에게 전달되는 시스템 프롬프트나 지침은 별도 파일로 관리하여 유지보수를 용이하게 합니다.

### 상태 관리 (Persistence)
확장은 세션이 종료되어도 상태를 유지해야 할 때가 있습니다.
- **`globalThis` 활용**: Node.js 프로세스 내에서 전역 상태를 유지합니다.
- **파일 저장**: `states.json` 또는 `settings.json`을 사용하여 물리적 파일에 상태를 기록합니다.

### 계층적 의존성 규칙 (pi-fleet 특화)
`pi-fleet` 프로젝트는 다음의 엄격한 import 방향을 준수해야 합니다.
- `core/` ← `metaphor/` ← `fleet/`
- **역방향 import 절대 금지**: 상위 모듈이 하위 모듈을 참조해서는 안 됩니다.

### index.ts 등록 패턴 예시
```ts
import { ExtensionContext } from '@mariozechner/pi-coding-agent';

export async function register(ctx: ExtensionContext) {
    // 1. 도구 등록
    ctx.sessionManager.defineTool({
        name: 'my_tool',
        description: '설명',
        execute: async (args) => { ... }
    });

    // 2. UI 컴포넌트 등록
    ctx.ui.registerComponent('my-panel', (width) => {
        return ['Hello PI!'];
    });

    // 3. 키바인딩 등록
    ctx.keybinds.register({
        id: 'my.action',
        key: 'ctrl+m',
        handler: () => { ... }
    });
}
```

---

## 4. PI SDK 심화

SDK를 직접 사용하여 에이전트 세션을 제어할 수 있습니다.

원본 문서: `$PI_ROOT/docs/sdk.md`

### 핵심 클래스
- **`AgentSession`**: 단일 대화 세션을 관리합니다.
- **`AgentSessionRuntime`**: 세션 실행 환경(도구, 프로바이더 등)을 정의합니다.

### 주요 API
- **`prompt(text)`**: 사용자 입력을 전달하고 에이전트 실행을 시작합니다.
- **`steer(text)`**: 진행 중인 세션에 개입하여 방향을 수정합니다.
- **`followUp(text)`**: 이전 대화 맥락을 유지하며 추가 질문을 던집니다.
- **`defineTool(definition)`**: 에이전트가 사용할 수 있는 도구를 정의합니다.
- **`ResourceLoader`**: 파일이나 리소스를 로드하는 추상화 계층입니다.

### 실행 모드 (Run Modes)
- **`InteractiveMode`**: 터미널 UI(TUI) 기반 상호작용.
- **`runPrintMode`**: 표준 출력(stdout)으로 결과를 출력하는 일회성 실행.
- **`runRpcMode`**: JSON-RPC를 통해 외부 프로그램과 통신.

---

## 5. 커스텀 프로바이더 & 모델 설정

사용자 정의 LLM 백엔드를 연결하거나 모델 파라미터를 조정합니다.

원본 문서: `$PI_ROOT/docs/custom-provider.md`, `$PI_ROOT/docs/models.md`

### 프로바이더 등록
```ts
ctx.sessionManager.registerProvider('my-provider', {
    async complete(params) {
        // LLM API 호출 로직
        return { text: '...', usage: { ... } };
    }
});
```

### models.json 설정 (`~/.pi/agent/models.json`)
```json
{
  "models": {
    "my-gpt": {
      "provider": "openai",
      "model": "gpt-4-turbo",
      "apiKey": "!security get-key",
      "maxContextWindow": 128000,
      "compat": "openai"
    }
  }
}
```
- **apiKey 해석**:
    - `!command`: 쉘 명령어를 실행하여 키를 가져옵니다 (권장).
    - `$ENV_VAR`: 환경 변수에서 가져옵니다.
    - `literal-string`: 문자열을 직접 사용합니다.
- **`compat` 필드**: Ollama, vLLM, LM Studio 등 OpenAI 호환 API를 사용하는 경우 `"openai"`로 설정합니다.

---

## 6. TUI 컴포넌트 개발

PI의 터미널 UI는 리액티브하게 렌더링됩니다.

원본 문서: `$PI_ROOT/docs/tui.md`

### 컴포넌트 구조
```ts
interface Component {
    render(width: number): string[];    // 화면에 그릴 문자열 배열 반환
    handleInput?(data: Buffer): boolean; // 키 입력 처리 (처리 완료 시 true)
    invalidate(): void;                 // 다시 그리기 요청
}
```

### 주요 개념
- **`CURSOR_MARKER`**: CJK(한글 등) IME 입력 시 커서 위치를 정확히 계산하기 위해 사용되는 특수 문자입니다.
- **오버레이(Overlay)**: 화면 중앙에 팝업처럼 띄우는 UI입니다.
    - `ctx.ui.custom(component, { overlay: true })`
- **내장 컴포넌트**: `Text`, `Box`, `Container`, `Spacer`, `Markdown`, `Image` 등을 조합하여 UI를 구성합니다.

### 키 입력 처리
`matchesKey(data, Key.ID)` 함수를 사용하여 입력을 식별합니다.
```ts
if (matchesKey(data, Key.ENTER)) { ... }
if (matchesKey(data, Key.CtrlC)) { ... }
```

### 구현 패턴
- **SelectList**: 항목 목록에서 선택하는 UI.
- **BorderedLoader**: 진행 상태를 보여주는 스피너.
- **SettingsList**: 설정을 토글하거나 값을 변경하는 UI.
- **CustomEditor**: 터미널 내 미니 편집기.

---

## 7. 테마(Theme)

PI의 색상은 JSON 테마 파일을 통해 관리됩니다.

원본 문서: `$PI_ROOT/docs/themes.md`

- **파일 구조**: 51개의 색상 토큰을 정의합니다 (예: `background`, `text`, `border.active`).
- **지원 값**:
    - `#RRGGBB`: RGB 색상.
    - `0-255`: xterm-256 팔레트 인덱스.
    - `"vars.name"`: 다른 토큰의 값을 참조.
    - `""` (빈 문자열): 터미널 기본 색상 사용.
- **로드 경로**:
    1. `~/.pi/agent/themes/`
    2. `.pi/themes/` (프로젝트 로컬)
    3. 확장 패키지 내 포함된 경로
- **핫 리로드**: 테마 파일을 저장하면 실행 중인 PI에 즉시 반영됩니다.

---

## 8. 키바인딩(Keybindings)

원본 문서: `$PI_ROOT/docs/keybindings.md`

- **설정 파일**: `~/.pi/agent/keybindings.json`
- **문법**: `modifier+key` 형식 (예: `ctrl+p`, `shift+alt+f`).
- **명령어**: `/reload` 명령을 실행하여 키바인딩 설정을 다시 로드할 수 있습니다.

---

## 9. 스킬(Skill) & 프롬프트 템플릿

코딩 없이 에이전트의 기능을 확장하는 간단한 방법입니다.

원본 문서: `$PI_ROOT/docs/skills.md`, `$PI_ROOT/docs/prompt-templates.md`

### 스킬 (Skill)
`SKILL.md` 파일을 작성하여 특정 도메인 지식이나 도구 사용법을 가르칩니다.
- **Frontmatter 필수 항목**: `name`, `description`.
- **호출**: 에이전트에게 `/skill:이름`을 입력하거나 시스템 프롬프트에 포함시킵니다.
- **로드 경로**: `~/.pi/agent/skills/`, `.pi/skills/`, 패키지 내부.

### 프롬프트 템플릿 (Prompt Templates)
자주 사용하는 복잡한 프롬프트를 슬래시 명령어로 단축합니다.
- **Frontmatter**: `description`, `argument-hint`.
- **인수 플레이스홀더**:
    - `$1`: 첫 번째 인자.
    - `$@`: 모든 인자.
    - `${@:N:L}`: N번째부터 L개 인자.
- **호출**: 터미널에서 `/템플릿이름` 입력.

---

## 10. 설정(Settings) 시스템

원본 문서: `$PI_ROOT/docs/settings.md`

### 계층 구조 (Priority)
1. **프로젝트 설정** (`.pi/settings.json`): 현재 디렉토리 기준, 가장 높은 우선순위.
2. **글로벌 설정** (`~/.pi/agent/settings.json`): 모든 프로젝트에 적용되는 기본값.

### 주요 설정 키
- `defaultProvider`, `defaultModel`: 기본 LLM 설정.
- `defaultThinkingLevel`: 추론 수준 (0-4).
- `theme`: 적용할 테마 이름.
- `compaction`: 컨텍스트 압축 전략.
- `extensions`: 로드할 확장 목록.

---

## 11. RPC 모드 (JSON-RPC)

외부 앱(IDE 플러그인 등)에서 PI를 제어할 때 사용합니다.

원본 문서: `$PI_ROOT/docs/rpc.md`

- **프로토콜**: JSONL (개행 문자로 구분된 JSON 객체) over stdin/stdout.
- **핵심 명령**: `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `get_state`, `set_model`.
- **Extension UI Request**: 확장이 RPC 클라이언트에게 UI 렌더링을 요청하는 서브프로토콜을 지원합니다.

---

## 12. pi 패키지 관리

원본 문서: `$PI_ROOT/docs/packages.md`

- **정의**: `package.json` 파일에 `pi` 키를 추가하여 확장, 스킬, 테마 등을 배포 가능한 패키지로 만듭니다.
- **설치 명령**:
    ```bash
    pi install npm:@scope/package-name
    pi install git:https://github.com/user/repo
    pi install ./local-path
    ```

---

## See also

- [Admiral Workflow Reference](./admiral-workflow-reference.md): Grand Fleet의 4계층 구조와 제독(Admiral)의 작전 지침을 다룹니다.
- [SETUP.md](../SETUP.md): 프로젝트 초기 설정 및 환경 구축 가이드.
- [AGENTS.md](../AGENTS.md): 각 디렉토리별 에이전트 행동 강령.
