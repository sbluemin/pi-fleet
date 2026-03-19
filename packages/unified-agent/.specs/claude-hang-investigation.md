# Claude ACP 요청 행(Hang) 원인 분석

> **조사 일자:** 2026-03-18
> **재현 환경:** `../pi-fleet` 경로에서 pi CLI → Claude direct/tool mode
> **재현 요청:** "unified-agent-core의 의존성이 업데이트 되었습니다. 모두 업데이트 해주세요"

---

## 1. 호출 체인 전체 추적

```
pi CLI (../pi-fleet)
 └─ unified-agent-tools/index.ts 또는 unified-agent-direct/index.ts
     └─ executor.ts → executeWithPool()
         └─ UnifiedAgentClient.sendMessage()
             └─ AcpConnection.sendPrompt()
                 └─ agent.prompt() [ACP JSON-RPC, timeout: 600,000ms]
                     └─ claude-agent-acp@0.20.2 bridge (npx spawn)
                         └─ Claude Code SDK
                             └─ Bash tool → npm install
                                 └─ git clone https://github.com/sbluemin/unified-agent.git
                                     └─ ⛔ 비대화형 환경에서 인증 프롬프트 대기 → HANG
```

---

## 2. 주요 원인: npm install의 Git 클론 행

### 2.1 의존성 참조 방식

**파일:** `../pi-fleet/extensions/unified-agent-core/package.json`

```json
{
  "dependencies": {
    "@sbluemin/unified-agent": "github:sbluemin/unified-agent"
  }
}
```

npm은 `github:` 프로토콜을 `https://github.com/sbluemin/unified-agent.git`으로 해석한다.

### 2.2 설치 과정에서 발생하는 일

npm이 이 의존성을 설치할 때:

1. **Git 클론** — `git clone https://github.com/sbluemin/unified-agent.git`
2. **devDependencies 설치** — npm 7+ 에서 lifecycle script 실행을 위해 devDeps도 설치
3. **`prepare` 스크립트 실행** — `package.json`에 `"prepare": "npm run build"` 설정

```json
// unified-agent (현재 프로젝트) package.json
{
  "scripts": {
    "prepare": "npm run build"   // → tsup 실행
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

4. **tsup 빌드** — TypeScript 컴파일 + ESM/CJS 듀얼 번들링

### 2.3 행(hang) 발생 메커니즘

Claude ACP 브릿지 내부에서 실행되는 bash 프로세스는 **비대화형(non-interactive) 환경**이다:

- `stdio: ['pipe', 'pipe', 'pipe']`로 spawn됨 (TTY 없음)
- stdin은 JSON-RPC 통신용으로 점유됨

이 환경에서 Git이 인증을 요구하면:

| 조건 | 결과 |
|------|------|
| 레포 public + credential helper 정상 | ✅ 정상 클론 |
| 레포 private + SSH 키 passphrase 필요 | ⛔ passphrase 프롬프트 대기 → **무한 행** |
| 레포 private + HTTPS + credential helper 없음 | ⛔ username/password 프롬프트 대기 → **무한 행** |
| 레포 private + HTTPS + credential helper가 GUI 기반 | ⛔ GUI 프롬프트 표시 불가 → **행 또는 타임아웃** |

### 2.4 환경변수 전파 경로

```
pi process (process.env)
 → cleanEnvironment() [src/utils/env.ts]
   제거: NODE_OPTIONS, NODE_INSPECT, NODE_DEBUG, CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, npm_*
   보존: PATH, HOME, SSH_AUTH_SOCK, GIT_* 등
 → ACP bridge (child process env)
   → Claude Code SDK (bridge의 process.env 그대로 전달)
     → Bash tool child process (Claude Code의 env 상속)
```

**파일:** `src/utils/env.ts`

```typescript
const REMOVE_KEYS = [
  'NODE_OPTIONS', 'NODE_INSPECT', 'NODE_DEBUG',
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
] as const;
// npm_ 접두사 변수도 제거
```

SSH/Git 관련 변수는 제거되지 않으므로 **자격 증명이 비대화형으로 사용 가능하면** 문제없다.
핵심은 "비대화형으로 사용 가능한가"이다.

---

## 3. 악화 요인

### 3.1 requestTimeout이 10분 (600,000ms)

**파일:** `src/connection/BaseConnection.ts:40`

```typescript
this.requestTimeout = options.requestTimeout ?? 600_000; // 10분
```

**파일:** `../pi-fleet/extensions/unified-agent-core/model-config.ts` — `buildConnectOptions()`

```typescript
const opts: Record<string, unknown> = {
  cwd,
  cli,
  autoApprove: true,
  clientInfo: CLIENT_INFO,
  // ← timeout 미설정 → 기본값 600,000ms 적용
};
```

Git 클론이 행하면 사용자는 **10분간 아무 피드백 없이** 대기하게 된다.
`AcpConnection.sendPrompt()`의 `withTimeout`이 10분 후 에러를 발생시키지만, 그때까지 체감은 "완전히 멈춤"이다.

```typescript
// AcpConnection.ts — sendPrompt()
const response = await this.withTimeout(
  agent.prompt({ sessionId, prompt }),
  this.requestTimeout,  // 600,000ms
  'session/prompt',
);
```

### 3.2 터미널 출력 스트리밍 미지원

**파일:** `src/connection/AcpConnection.ts` — `createClientHandler()`

```typescript
const clientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  permissions: true,
  terminal: false,   // ← 터미널 API 미지원
};
```

Claude ACP 브릿지(0.20.2)는 `_meta.terminal_output` 플래그로 bash 출력 스트리밍을 지원한다:

```javascript
// claude-agent-acp/dist/acp-agent.js:641
const supportsTerminalOutput = this.clientCapabilities?._meta?.["terminal_output"] === true;
```

하지만 unified-agent 클라이언트는 이 메타 플래그를 선언하지 않으므로, **npm install 진행 상황이 전혀 스트리밍되지 않는다.**
사용자에게는 tool_call 이벤트("Bash" 실행 중)만 보이고, 그 이후 출력은 완전 침묵.

### 3.3 effort / budgetTokens가 ACP에 미적용

**파일:** `../pi-fleet/extensions/unified-agent-core/selected-models.json`

```json
{
  "claude": {
    "model": "opus",
    "effort": "high",
    "budgetTokens": 16384
  }
}
```

**파일:** `../pi-fleet/extensions/unified-agent-core/model-config.ts` — `buildConnectOptions()`

```typescript
// effort와 budgetTokens를 opts에 추가
if (cli === "claude" && cliConfig) {
  if (cliConfig.effort) opts.effort = cliConfig.effort;       // "high"
  if (cliConfig.budgetTokens) opts.budgetTokens = cliConfig.budgetTokens; // 16384
}
```

**파일:** `src/client/UnifiedAgentClient.ts` — `connectAcp()`

```typescript
// YOLO 모드 설정 (yoloMode 미설정이므로 스킵됨)
if (options.yoloMode && session.sessionId) { ... }

// 모델 설정 (opus 적용됨)
if (options.model && session.sessionId) {
  await this.acpConnection.setModel(session.sessionId, options.model);
}

// ⚠️ effort 적용 로직 없음!
// 아래와 같은 코드가 있어야 하지만 없다:
// if (options.effort && session.sessionId) {
//   await this.acpConnection.setConfigOption(session.sessionId, 'reasoning_effort', options.effort);
// }
```

| 설정 | buildConnectOptions에서 전달 | connectAcp에서 적용 |
|------|:---:|:---:|
| `model: "opus"` | ✅ | ✅ `setModel()` |
| `effort: "high"` | ✅ | ❌ **누락** |
| `budgetTokens: 16384` | ✅ | ❌ **누락** (타입에도 없음) |
| `autoApprove: true` | ✅ | ✅ `AcpConnection` 생성자 |

직접적인 행 원인은 아니지만, 사용자가 의도한 thinking 설정이 적용되지 않는 버그.

### 3.4 YOLO 모드 미설정

`buildConnectOptions()`에서 `yoloMode: true`를 설정하지 않는다.
대신 `autoApprove: true`가 설정되어 매 권한 요청마다 클라이언트 측에서 자동 승인한다.

**비교:**

| 방식 | 동작 | 오버헤드 |
|------|------|----------|
| `autoApprove: true` | bridge → client → 자동승인 → bridge (매 tool use마다) | JSON-RPC 왕복 |
| `yoloMode (bypassPermissions)` | bridge가 자체 승인 (client 미관여) | 없음 |

`autoApprove`로도 정상 동작하지만, 불필요한 JSON-RPC 왕복이 발생한다.

---

## 4. 권한 요청(requestPermission) 흐름 검증

행이 requestPermission 핸들러에서 발생할 가능성도 조사했다.

### 4.1 autoApprove 로직

**파일:** `src/connection/AcpConnection.ts` — `createClientHandler()`

```typescript
requestPermission: async (params) => {
  if (this.autoApprove && params.options && params.options.length > 0) {
    return {
      outcome: { outcome: 'selected', optionId: params.options[0].optionId },
    };
  }
  // ⚠️ fallback: 이벤트 기반 — 리스너가 없으면 무한 대기
  return new Promise((resolve) => {
    this.emit('permissionRequest', params, trackedResolve);
  });
},
```

### 4.2 Claude ACP 브릿지의 권한 요청 형태

```javascript
// claude-agent-acp/dist/acp-agent.js — 일반 도구 사용 시
const response = await this.client.requestPermission({
  options: [
    { kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
    { kind: "allow_once", name: "Allow", optionId: "allow" },
    { kind: "reject_once", name: "Reject", optionId: "reject" },
  ],
  sessionId,
  toolCall: { ... },
});
```

**검증 결과:**
- `params.options`는 ACP 스키마에서 `Array<PermissionOption>` (required, 비어있을 수 없음)
- Claude ACP 브릿지는 항상 3개 옵션을 전달
- `autoApprove` 조건 (`options && options.length > 0`) 충족 ✅
- 첫 번째 옵션 `allow_always` 선택 → 정상 승인 ✅

**결론:** requestPermission은 행의 원인이 아님.

### 4.3 ExitPlanMode 특수 케이스

Claude가 plan 모드에서 시작한 경우, ExitPlanMode 도구가 호출될 수 있다:

```javascript
// ExitPlanMode 권한 요청
options: [
  { kind: "allow_always", name: "Yes, and auto-accept edits", optionId: "acceptEdits" },
  { kind: "allow_once", name: "Yes, and manually approve edits", optionId: "default" },
  { kind: "reject_once", name: "No, keep planning", optionId: "plan" },
]
```

autoApprove는 첫 번째 옵션 `acceptEdits` 선택 → 정상 처리 ✅

---

## 5. 세션 재개(resume) 검증

### 5.1 세션 매핑

**파일:** `../pi-fleet/extensions/unified-agent-core/session-maps/`

이전 세션의 Claude sessionId가 저장되어 있을 수 있다:

```json
// 예: 32ed3d1e-c429-4497-a3a1-c3007ccd3a47.json
{ "claude": "ff3a1eeb-f455-49e9-b02c-bee59ce43ff8" }
```

### 5.2 재개 실패 시 복구 흐름

**파일:** `../pi-fleet/extensions/unified-agent-core/executor.ts`

```typescript
try {
  connectResult = await client.connect(connectOpts as any);
} catch (connectError) {
  if (!savedSessionId) throw connectError;
  // resume 실패 → 세션 초기화 → 새 클라이언트로 재시도
  clearSubSessionId(cli);
  delete connectOpts.sessionId;
  client = new UnifiedAgentClient();
  connectResult = await client.connect(connectOpts as any);
}
```

**검증 결과:** resume 실패 시 올바르게 폴백. 행의 원인이 아님 ✅

---

## 6. ACP SDK 타임아웃 구조

```
┌─────────────────────────────────────────────────┐
│ initTimeout (60s) — initialize + session/new    │
├─────────────────────────────────────────────────┤
│ requestTimeout (600s) — session/prompt          │  ← 행 체감 구간
├─────────────────────────────────────────────────┤
│ disconnect timeout (5s) — SIGTERM → SIGKILL     │
└─────────────────────────────────────────────────┘
```

`session/prompt`의 10분 타임아웃이 유일한 안전장치.
Git 클론이 행하면 이 10분 동안 사용자에게 아무 피드백이 없다.

---

## 7. 결론

### 근본 원인 (Root Cause)

| # | 원인 | 심각도 | 위치 |
|---|------|--------|------|
| 1 | `github:` 의존성의 Git 클론이 비대화형 환경에서 인증 행 | 🔴 **주요** | Claude bash → npm → git |
| 2 | requestTimeout 10분 (행 중 피드백 없음) | 🟡 악화 | `BaseConnection.ts` |
| 3 | terminal_output 미지원 (진행 상황 불가시) | 🟡 악화 | `AcpConnection.ts` |
| 4 | effort/budgetTokens ACP 미적용 | 🟠 별도 버그 | `UnifiedAgentClient.ts` |

### 해결 방안

#### 즉시 적용 (pi-fleet 측)

1. **`github:` 참조를 `file:` 로컬 참조로 변경**

```json
// ../pi-fleet/extensions/unified-agent-core/package.json
{
  "dependencies": {
    "@sbluemin/unified-agent": "file:../../../unified-agent"
  }
}
```

2. **프롬프트에 npm install 회피 지시 추가**

> "unified-agent-core의 의존성이 업데이트 되었습니다.
> node_modules는 이미 갱신되어 있으니 npm install은 실행하지 말고,
> 타입이나 API 변경사항만 코드에 반영해주세요."

#### SDK 개선 (unified-agent 측)

3. **`connectAcp()`에서 effort 적용 추가**

```typescript
// UnifiedAgentClient.ts — connectAcp() 말미에 추가
if (options.effort && session.sessionId) {
  try {
    await this.acpConnection.setConfigOption(
      session.sessionId, 'reasoning_effort', options.effort
    );
  } catch { /* 미지원 시 무시 */ }
}
```

4. **requestTimeout을 합리적 수준으로 조정 또는 설정 가능하게**

```typescript
// buildConnectOptions에서 timeout 설정
opts.timeout = 180_000; // 3분
```

5. **terminal_output 메타 플래그 지원 검토**

```typescript
const clientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  permissions: true,
  terminal: false,
  _meta: { terminal_output: true },  // bash 출력 스트리밍 활성화
};
```

---

## 부록: 조사한 파일 목록

| 파일 | 역할 |
|------|------|
| `src/client/UnifiedAgentClient.ts` | 통합 클라이언트 (connect → sendMessage 흐름) |
| `src/connection/AcpConnection.ts` | ACP 프로토콜 구현 (sendPrompt, requestPermission) |
| `src/connection/BaseConnection.ts` | 프로세스 spawn + 타임아웃 |
| `src/config/CliConfigs.ts` | Claude ACP 브릿지 spawn 설정 |
| `src/utils/env.ts` | 환경변수 정제 |
| `src/utils/npx.ts` | npx 경로 해석 |
| `src/utils/process.ts` | 프로세스 종료 |
| `src/types/config.ts` | UnifiedClientOptions 타입 정의 |
| `../pi-fleet/extensions/unified-agent-core/executor.ts` | executeWithPool 실행기 |
| `../pi-fleet/extensions/unified-agent-core/model-config.ts` | buildConnectOptions |
| `../pi-fleet/extensions/unified-agent-core/client-pool.ts` | 클라이언트 풀 관리 |
| `../pi-fleet/extensions/unified-agent-core/session-map.ts` | 세션 매핑 |
| `../pi-fleet/extensions/unified-agent-core/selected-models.json` | 현재 모델 설정 |
| `~/.npm/_npx/.../claude-agent-acp/dist/acp-agent.js` | Claude ACP 브릿지 소스 |
| `node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` | ACP SDK 타입 |
