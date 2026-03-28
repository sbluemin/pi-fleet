# unified-agent-task — 서브에이전트 태스크 시스템

> **핵심 목표**: `unified-agent-direct/core/agent/executor.ts`의 `executeOneShot`을 활용하여 메인 에이전트 컨텍스트와 독립된 1회성 태스크를 **병렬 분산 처리**하는 서브에이전트 도구를 제공한다.

---

## 1. 설계 원칙

### 1.1 pi-fleet 특화 설계

| 원칙 | 설명 |
|------|------|
| **멀티 CLI 병렬성** | claude/codex/gemini 3개 CLI를 동시에 활용하여 태스크를 분산 |
| **oneshot 기반** | 세션을 유지하지 않는 일회성 실행 — 매번 새 연결/세션 |
| **도구(tool)로 제공** | 사용자 키바인딩이 아닌, LLM이 판단하여 호출하는 pi tool |
| **확장 API로 커스텀 지원** | md 파일 기반 에이전트 정의 ❌ → `globalThis` API로 다른 확장이 태스크 타입을 등록 |

### 1.2 왜 `executeOneShot` 직접 호출인가

`unified-agent-direct`의 `runAgentRequest()`는 세션 유지 + 에이전트 패널 동기화 + stream-store 관리 등 **인터랙티브 대화**에 특화된 파이프라인입니다. 태스크 시스템은 이와 본질적으로 다릅니다:

- **1회성**: 세션 매핑/복원이 불필요
- **패널 독립**: 에이전트 패널과 무관하게 tool block으로만 표시
- **다중 인스턴스**: 같은 CLI를 동시에 여러 개 실행해야 함 (pool의 busy 충돌 회피)

따라서 `unified-agent-direct/core/agent/executor.ts`의 `executeOneShot`을 직접 사용하는 것이 올바른 계층 선택입니다.

### 1.3 `systemPrefix`는 user prompt 앞에 붙이는 것

`executeOneShot`의 `request` 필드는 user message 문자열입니다. 태스크 타입의 `systemPrefix`는 이 `request` 앞에 텍스트를 결합하는 방식입니다. **별도의 system prompt 주입이 아님**을 명확히 합니다:

```typescript
// 실제 전달
request = `${taskType.systemPrefix}\n\n${item.prompt}`;
```

### 1.4 opencode / pi subagent 예제와의 차별점

| 비교 대상 | 차이 |
|-----------|------|
| **opencode** | 읽기 전용 도구만 → **CLI 전체 도구 사용** / 순차 실행 → **실제 병렬** / 인라인만 → **tool block + onUpdate 스트리밍** |
| **pi subagent 예제** | `pi` 프로세스 spawn → **ACP 클라이언트 직접 실행** / md 파일 에이전트 → **확장 API만** / 단일 모델 → **멀티 CLI 분산** |

---

## 2. 아키텍처

### 2.1 계층 구조

```
unified-agent-task/           ← 확장 (index.ts 포함)
├── index.ts                  ← 와이어링: 도구 등록 + globalThis API 노출
├── types.ts                  ← 공개 타입 + globalThis 브릿지 키/인터페이스
├── prompts.ts                ← 도구 description/promptSnippet/promptGuidelines
├── executor.ts               ← 태스크 실행 엔진 (single/parallel)
├── registry.ts               ← 태스크 타입 레지스트리 (globalThis 노출)
└── render.ts                 ← renderCall + renderResult
```

### 2.2 의존 관계

```
unified-agent-task
  ├── unified-agent-direct/core/agent/executor.ts  ← executeOneShot (직접 호출)
  ├── unified-agent-direct/core/agent/types.ts     ← ExecuteResult, ToolCallInfo, AgentStatus
  ├── @sbluemin/unified-agent                      ← CliType
  └── @mariozechner/pi-coding-agent                ← ExtensionAPI, ExtensionContext (pi 프레임워크)

  ※ model/effort/budgetTokens는 호출자가 Push 방식으로 ExecuteOptions에 주입
     (executeOneShot은 configDir을 사용하지 않음 — 파일 읽기 없음)
```

---

## 3. 공개 API (globalThis 브릿지)

> 다른 확장에서 사용할 수 있는 2개의 공개 API를 제공합니다.

### 3.1 globalThis 키

```typescript
/** 태스크 타입 등록 API 키 */
const TASK_REGISTRY_KEY = "__pi_ua_task_registry__";

/** 태스크 실행 API 키 */
const TASK_EXECUTOR_KEY = "__pi_ua_task_executor__";
```

### 3.2 TaskRegistryBridge — 태스크 타입 등록

다른 확장이 전담 태스크 타입을 정의할 때 사용합니다.

```typescript
interface TaskRegistryBridge {
  /**
   * 커스텀 태스크 타입을 등록합니다.
   * 등록된 타입은 LLM 도구의 promptGuidelines에 동적으로 반영됩니다.
   *
   * @returns 등록 해제 함수
   */
  register(config: TaskTypeConfig): () => void;

  /**
   * 등록된 모든 태스크 타입을 조회합니다.
   */
  list(): TaskTypeConfig[];

  /**
   * 특정 태스크 타입을 이름으로 조회합니다.
   */
  get(name: string): TaskTypeConfig | undefined;
}

interface TaskTypeConfig {
  /** 고유 식별자 (예: "code-review", "security-audit") */
  name: string;

  /** LLM에게 보여줄 태스크 타입 설명 */
  description: string;

  /**
   * 태스크 프롬프트 앞에 결합될 지시문.
   * user prompt의 앞부분에 텍스트로 결합됩니다 (system prompt 아님).
   */
  systemPrefix?: string;

  /** 기본 사용 CLI (미지정 시 호출자가 선택) */
  defaultCli?: CliType;

  /** 프롬프트 유휴 타임아웃 오버라이드 (ms) */
  promptIdleTimeout?: number;
}
```

#### 등록 예시

```typescript
// 예: subagent-reviewer 확장
export default function (pi: ExtensionAPI) {
  const registry = globalThis["__pi_ua_task_registry__"] as TaskRegistryBridge | undefined;
  if (!registry) return;

  const unregister = registry.register({
    name: "code-review",
    description: "Git diff를 분석하고 코드 품질/컨벤션 피드백을 제공합니다",
    systemPrefix: "You are a senior code reviewer. Focus on: ...",
    defaultCli: "claude",
  });

  // 확장 해제 시 등록도 해제 (필요한 경우)
  // unregister();
}
```

#### promptGuidelines 동적 반영

`prompts.ts`에서 도구의 `promptGuidelines`를 생성할 때, 레지스트리에 등록된 타입 목록을 동적으로 포함합니다:

```typescript
// prompts.ts
export function taskPromptGuidelines(): string {
  const registry = getRegistry(); // globalThis에서 가져오기
  const types = registry.list();

  let guidelines = BASE_GUIDELINES;
  if (types.length > 0) {
    guidelines += "\n\nAvailable task types:\n";
    for (const t of types) {
      guidelines += `- "${t.name}": ${t.description}`;
      if (t.defaultCli) guidelines += ` (default: ${t.defaultCli})`;
      guidelines += "\n";
    }
  }
  return guidelines;
}
```

> **참고**: `registerTool`의 `promptGuidelines`는 **함수**도 허용합니다.
> 매 호출 시 최신 레지스트리를 반영하므로, 나중에 등록된 타입도 LLM이 발견할 수 있습니다.

### 3.3 TaskExecutorBridge — 태스크 실행

다른 확장이 프로그래밍적으로 태스크를 실행할 때 사용합니다.

```typescript
interface TaskExecutorBridge {
  /**
   * 단일 태스크를 실행합니다.
   *
   * @param item - 태스크 정의 (cli, prompt, taskType)
   * @param options - 실행 옵션
   * @returns 태스크 결과
   */
  run(item: TaskItem, options?: TaskRunOptions): Promise<TaskResult>;

  /**
   * 여러 태스크를 병렬 실행합니다.
   * MAX_CONCURRENCY에 의해 동시 실행 수가 제한됩니다.
   *
   * @param items - 태스크 배열
   * @param options - 실행 옵션
   * @returns 태스크 결과 배열 (입력 순서 보장)
   */
  runParallel(items: TaskItem[], options?: TaskRunOptions): Promise<TaskResult[]>;

  /**
   * 같은 프롬프트를 여러 CLI에 동시 전송합니다 (fan-out).
   *
   * @param prompt - 공통 프롬프트
   * @param clis - 대상 CLI 목록 (미지정 시 전체)
   * @param options - 실행 옵션
   * @returns CLI별 결과 배열
   */
  fanOut(prompt: string, clis?: CliType[], options?: TaskRunOptions): Promise<TaskResult[]>;

  /**
   * 순차 파이프라인을 실행합니다.
   * 각 단계의 prompt에서 {previous}가 이전 결과로 치환됩니다.
   * 단계 실패 시 즉시 중단합니다.
   *
   * @param items - 순서대로 실행할 태스크 배열
   * @param options - 실행 옵션
   * @returns 실행된 단계의 결과 배열
   */
  chain(items: TaskItem[], options?: TaskRunOptions): Promise<TaskResult[]>;
}
```

#### 공통 타입

```typescript
/** 단일 태스크 항목 */
interface TaskItem {
  /** 대상 CLI (미지정 시: taskType의 defaultCli → 설정 기본값) */
  cli?: CliType;
  /** 태스크에 전달할 프롬프트 */
  prompt: string;
  /** 등록된 태스크 타입 이름 (systemPrefix 자동 주입) */
  taskType?: string;
}

/** 실행 옵션 */
interface TaskRunOptions {
  /** 취소 시그널 */
  signal?: AbortSignal;
  /** 작업 디렉토리 오버라이드 (미지정 시 현재 세션 cwd) */
  cwd?: string;
  /** 메시지 청크 콜백 (실시간 스트리밍) */
  onMessageChunk?: (cli: CliType, text: string) => void;
  /** 도구 호출 콜백 */
  onToolCall?: (cli: CliType, title: string, status: string, rawOutput?: string) => void;
  /** 상태 변경 콜백 */
  onStatusChange?: (cli: CliType, status: AgentStatus) => void;
}

/** 태스크 실행 결과 */
interface TaskResult {
  /** 대상 CLI */
  cli: CliType;
  /** 최종 응답 텍스트 */
  responseText: string;
  /** 사고 과정 텍스트 */
  thoughtText: string;
  /** 도구 호출 추적 */
  toolCalls: ToolCallInfo[];
  /** 최종 상태 */
  status: "done" | "error" | "aborted";
  /** 오류 메시지 */
  error?: string;
  /** chain 모드에서의 단계 번호 (1-based) */
  step?: number;
  /** 실행 소요 시간 (ms) */
  elapsed: number;
}
```

> **`TaskResult.status`는 `AgentStatus`의 최종 3종만 사용합니다.**
> `"connecting"` / `"running"` 은 중간 상태이므로 결과에 포함하지 않습니다.

#### 사용 예시 — 다른 확장에서

```typescript
// 예: orchestration 확장에서 태스크 시스템 활용
export default function (pi: ExtensionAPI) {
  const executor = globalThis["__pi_ua_task_executor__"] as TaskExecutorBridge | undefined;
  if (!executor) return;

  pi.registerTool({
    name: "analyze-codebase",
    // ...
    async execute(_id, params, signal, _onUpdate, ctx) {
      // 3개 CLI에 같은 분석 요청을 fan-out
      const results = await executor.fanOut(
        `Analyze: ${params.query}`,
        ["claude", "codex", "gemini"],
        { signal },
      );

      // 결과 합성
      const summary = results
        .filter(r => r.status === "done")
        .map(r => `## ${r.cli}\n${r.responseText}`)
        .join("\n\n---\n\n");

      return { content: [{ type: "text", text: summary }] };
    },
  });

  // chain 예시: 분석 → 계획 → 구현
  pi.registerTool({
    name: "implement-feature",
    // ...
    async execute(_id, params, signal) {
      const results = await executor.chain([
        { cli: "gemini", prompt: `Analyze codebase for: ${params.feature}` },
        { cli: "claude", prompt: `Create implementation plan:\n\n{previous}` },
        { cli: "codex", prompt: `Implement this plan:\n\n{previous}` },
      ], { signal });

      const last = results[results.length - 1];
      return {
        content: [{ type: "text", text: last.responseText }],
        isError: last.status !== "done",
      };
    },
  });
}
```

---

## 4. LLM 도구 인터페이스

### 4.1 도구 파라미터 스키마 (MVP)

> **설계 원칙**: LLM이 잘못된 조합을 생성할 확률을 최소화합니다.
> `prompt` 필드가 있으면 single, `tasks` 배열이 있으면 parallel — 두 가지만 구분합니다.

```typescript
const TaskToolParams = Type.Object({
  // ── Single 모드: prompt만 지정 ──
  prompt: Type.Optional(Type.String({
    description: "Task prompt (single mode)",
  })),
  cli: Type.Optional(StringEnum(["claude", "codex", "gemini"], {
    description: "Target CLI for single mode (default: auto-select)",
  })),
  taskType: Type.Optional(Type.String({
    description: "Registered task type name (applies systemPrefix)",
  })),

  // ── Parallel 모드: tasks 배열 ──
  tasks: Type.Optional(Type.Array(
    Type.Object({
      prompt: Type.String(),
      cli: Type.Optional(StringEnum(["claude", "codex", "gemini"])),
      taskType: Type.Optional(Type.String()),
    }),
    { description: "Array of tasks for parallel execution (max 6)" },
  )),
});
```

### 4.2 모드 판별 로직

```typescript
// prompt가 있으면 single, tasks가 있으면 parallel
// 둘 다 있거나 둘 다 없으면 에러
if (params.prompt && !params.tasks) → single 모드
if (params.tasks && !params.prompt) → parallel 모드
else → 에러 + 사용법 안내
```

### 4.3 fan-out / chain은 LLM 도구 스키마에 미포함

**fan-out**과 **chain**은 LLM이 직접 호출하는 도구 파라미터에는 포함하지 않습니다:

| 모드 | LLM 도구 | 확장 API (`TaskExecutorBridge`) |
|------|----------|-------------------------------|
| single | ✅ | ✅ `run()` |
| parallel | ✅ | ✅ `runParallel()` |
| fan-out | ❌ (parallel로 같은 prompt 지정) | ✅ `fanOut()` |
| chain | ❌ | ✅ `chain()` |

**이유**:
- fan-out은 parallel에서 같은 prompt + 서로 다른 cli를 지정하면 동일
- chain의 `{previous}` 플레이스홀더는 LLM에게 직관적이지 않음
- 두 모드 모두 **다른 확장이 프로그래밍적으로** 사용하는 것이 자연스러움

---

## 5. 실행 엔진 (`executor.ts`)

### 5.1 제한값

```typescript
/** 최대 동시 실행 수 (CLI 프로세스 부하 고려) */
const MAX_CONCURRENCY = 3;

/** 최대 태스크 수 */
const MAX_TASKS = 6;
```

> `MAX_CONCURRENCY = 3`: CLI 종류 수와 동일. 각 CLI 프로세스의 메모리(200-500MB)를 고려하여 보수적으로 설정. 벤치마크 후 조정 가능.

### 5.2 단일 태스크 실행

```typescript
async function executeSingleTask(
  item: TaskItem,
  cwd: string,
  signal?: AbortSignal,
  callbacks?: {
    onMessageChunk?: (cli: CliType, text: string) => void;
    onToolCall?: (cli: CliType, title: string, status: string, rawOutput?: string) => void;
    onStatusChange?: (cli: CliType, status: AgentStatus) => void;
  },
): Promise<TaskResult> {
  const cli = resolveCli(item);                    // item.cli ?? taskType.defaultCli ?? 기본값
  const prompt = buildPrompt(item);                // systemPrefix + prompt 결합
  const timeout = resolveTimeout(item.taskType);   // taskType.promptIdleTimeout
  const modelConfig = resolveModelConfig(cli);     // Push 방식: 호출자가 설정 파일에서 읽어 주입
  const startTime = Date.now();

  const result = await executeOneShot({
    cli,
    request: prompt,
    cwd,
    model: modelConfig?.model,
    effort: modelConfig?.effort,
    budgetTokens: modelConfig?.budgetTokens,
    signal,
    promptIdleTimeout: timeout,
    onMessageChunk: (text) => callbacks?.onMessageChunk?.(cli, text),
    onThoughtChunk: () => {},    // thoughtText는 result에서 수집
    onToolCall: (title, status, rawOutput) =>
      callbacks?.onToolCall?.(cli, title, status, rawOutput),
    onStatusChange: (status) => callbacks?.onStatusChange?.(cli, status),
  });

  return {
    cli,
    responseText: result.responseText,
    thoughtText: result.thoughtText,
    toolCalls: result.toolCalls,
    status: toFinalStatus(result.status),   // "done" | "error" | "aborted"
    error: result.error,
    elapsed: Date.now() - startTime,
  };
}
```

### 5.3 병렬 실행

```typescript
async function executeParallelTasks(
  items: TaskItem[],
  cwd: string,
  signal?: AbortSignal,
  callbacks?: { /* 위와 동일, index 추가 */ },
): Promise<TaskResult[]> {
  if (items.length > MAX_TASKS) {
    throw new Error(`최대 ${MAX_TASKS}개까지 지원합니다 (요청: ${items.length}개).`);
  }

  return mapWithConcurrencyLimit(items, MAX_CONCURRENCY, (item, index) =>
    executeSingleTask(item, cwd, signal, /* ... */),
  );
}
```

### 5.4 결과 크기 제한 (truncation)

pi 도구 출력 제한 (50KB / 2000줄)을 준수합니다:

```typescript
/**
 * 결과를 LLM 전달용으로 truncate합니다.
 * - 단일 태스크: 전체 50KB/2000줄
 * - 병렬 N개: 태스크당 floor(50KB/N) / floor(2000/N)
 */
function truncateForLLM(results: TaskResult[]): string {
  const perTaskLimit = Math.floor(50_000 / results.length);
  const perTaskLines = Math.floor(2000 / results.length);

  return results.map(r => {
    const text = truncate(r.responseText, perTaskLimit, perTaskLines);
    const icon = r.status === "done" ? "✓" : "✗";
    return `## ${icon} ${r.cli} [${r.elapsed}ms]\n\n${text}`;
  }).join("\n\n---\n\n");
}
```

> **LLM 전달용**과 **TUI 표시용**은 분리됩니다:
> - LLM: truncated 텍스트 (content 필드)
> - TUI: `renderResult`에서 `details`를 사용하여 축소/확장 뷰 렌더링

---

## 6. 렌더링 (`render.ts`)

### 6.1 renderCall — 도구 호출 표시

```
▸ task claude
  "src/ 디렉토리 구조 분석해줘"

▸ task parallel (3 tasks)
  claude: "인증 코드 찾아줘"
  gemini: "DB 스키마 분석해줘"
  codex:  "API 목록 만들어줘"
```

### 6.2 renderResult — 결과 표시

**축소 뷰** (기본):
```
✓ claude [2.3s]
  └ read: src/main.ts:1-50
  └ grep: /auth/ in src/
  결과 미리보기 (첫 3줄)...

✓ gemini [1.8s]
  └ ls: src/db/
  결과 미리보기 (첫 3줄)...
```

**확장 뷰** (Ctrl+O):
- 전체 도구 호출 목록
- 전체 응답 텍스트 (마크다운 렌더링)
- 소요 시간, 도구 호출 횟수 등 메타데이터

### 6.3 실시간 진행 표시 (`onUpdate`)

pi의 tool execute에서 `onUpdate` 콜백으로 실행 중 진행 상황을 갱신합니다:

```
⏳ task parallel (1/3 done, 2 running)
  ✓ claude [1.2s]
  ⏳ gemini — └ ls: src/db/models/
  ⏳ codex  — └ bash: grep -r "endpoint" ...
```

---

## 7. 오류 처리

| 상황 | 동작 |
|------|------|
| 단일 태스크 실패 | `isError: true`로 결과 반환, LLM에게 에러 메시지 전달 |
| 병렬 중 일부 실패 | 다른 태스크는 계속 실행, 실패한 것만 에러 표시 |
| chain 중 단계 실패 | 즉시 중단, 실패 단계와 이유 보고 (API 전용) |
| 사용자 취소 (Esc) | pi가 tool execute에 전달하는 `signal`을 통해 전파 → `cancelPrompt` 호출 |
| CLI 연결 실패 | 해당 태스크만 에러, 다른 CLI 태스크는 정상 진행 |
| 잘못된 파라미터 | prompt/tasks 중 정확히 하나만 지정하지 않으면 에러 + 사용법 안내 |
| 결과 크기 초과 | `truncateForLLM()`으로 50KB/2000줄 이내로 자르고 TUI에는 전체 표시 |

---

## 8. 제약 사항

| 항목 | 제약 |
|------|------|
| **컨텍스트 공유** | 없음 — 각 태스크는 완전히 격리된 oneshot 실행 |
| **세션 유지** | 없음 — 매 실행마다 새 연결/세션 |
| **태스크 간 통신** | chain의 `{previous}` 플레이스홀더만 지원 (API 전용), 양방향 통신 없음 |
| **최대 동시 실행** | 3 (CLI 프로세스 부하 고려, 벤치마크 후 조정) |
| **최대 태스크 수** | 6개 (메모리/프로세스 보호) |
| **결과 크기 (LLM)** | 합산 50KB / 2000줄 제한 (pi 도구 출력 제한 준수) |
| **결과 크기 (TUI)** | renderResult에서 축소/확장 뷰로 전체 표시 |
| **패널 연동** | 없음 — `unified-agent-direct`의 에이전트 패널과 독립 |

---

## 9. `index.ts` 와이어링 개요

```typescript
export default function (pi: ExtensionAPI) {
  // 1. 레지스트리 초기화 + globalThis 노출
  const registry = createRegistry();
  (globalThis as any)[TASK_REGISTRY_KEY] = registry;

  // 2. 실행기 초기화 + globalThis 노출
  // model/effort/budgetTokens는 executeSingleTask 내부에서
  // loadSelectedModels()로 읽어 Push 방식으로 executeOneShot에 전달
  const executor: TaskExecutorBridge = {
    run: (item, opts) => executeSingleTask(item, opts?.cwd ?? process.cwd(), opts?.signal, opts),
    runParallel: (items, opts) => executeParallelTasks(items, opts?.cwd ?? process.cwd(), opts?.signal, opts),
    fanOut: (prompt, clis, opts) => /* parallel로 위임 */,
    chain: (items, opts) => executeChainTasks(items, opts?.cwd ?? process.cwd(), opts?.signal, opts),
  };
  (globalThis as any)[TASK_EXECUTOR_KEY] = executor;

  // 3. pi 도구 등록
  pi.registerTool({
    name: "task",
    label: "Task",
    description: taskDescription(),
    promptSnippet: taskPromptSnippet(),
    promptGuidelines: () => taskPromptGuidelines(),  // 함수: 매 호출 시 레지스트리 반영
    parameters: TaskToolParams,
    execute: (id, params, signal, onUpdate, ctx) => { /* executor 위임 */ },
    renderCall: renderTaskCall,
    renderResult: renderTaskResult,
  });
}
```

---

## 10. 향후 확장 가능성

> 본 SPEC은 MVP 범위입니다. 아래는 추후 고려할 수 있는 방향입니다.

| 방향 | 설명 |
|------|------|
| **MAX_CONCURRENCY 조정** | 벤치마크 결과에 따라 3 → 4~6으로 상향 가능 |
| **결과 캐싱** | 동일 프롬프트+CLI 조합의 결과를 세션 내 캐싱하여 중복 실행 방지 |
| **부분 컨텍스트 주입** | 메인 세션의 최근 N개 메시지를 태스크에 요약 주입 |
| **에이전트 패널 연동** | fan-out 결과를 에이전트 패널 3분할 뷰로 표시 |
| **비용 추적** | 태스크별 토큰 사용량/비용 수집 및 집계 |
| **재시도 정책** | 실패한 태스크를 다른 CLI로 자동 재시도 |
| **LLM 도구에 chain 모드 추가** | LLM이 chain을 안정적으로 사용할 수 있는 UX가 확보되면 추가 |

---

## 11. 파일별 책임 요약

| 파일 | 책임 | 의존 |
|------|------|------|
| `index.ts` | 와이어링: 도구 등록, globalThis API 노출 | pi API, executor, registry, render, prompts |
| `types.ts` | 모든 공개 타입, globalThis 키, 브릿지 인터페이스 | unified-agent-direct/core/agent/types, @sbluemin/unified-agent |
| `prompts.ts` | 도구 description, promptSnippet, promptGuidelines (동적) | registry |
| `executor.ts` | 실행 엔진: single/parallel/fan-out/chain, 동시성 제어 | unified-agent-direct/core/agent/executor |
| `registry.ts` | 태스크 타입 CRUD, globalThis 레지스트리 | 없음 (순수 데이터) |
| `render.ts` | renderCall + renderResult: 축소/확장 뷰, onUpdate 진행 표시 | pi-tui |
