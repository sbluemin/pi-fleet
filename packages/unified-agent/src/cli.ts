/**
 * unified-agent CLI
 * 원샷 프롬프트 실행을 위한 CLI 진입점
 * (shebang은 tsup banner로 자동 추가)
 */

// Claude Code 내부에서 실행될 때 환경변수 충돌 방지
// (cli.ts 프로세스 자체가 Claude Code 세션 안에서 spawn되므로 즉시 제거)
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

import { parseArgs } from 'node:util';
import { UnifiedAgentClient } from './client/UnifiedAgentClient.js';
import type { CliType } from './types/config.js';
import { getModelsRegistry, getProviderModels } from './models/ModelRegistry.js';

import picocolors from 'picocolors';
import { CliRenderer } from './cli-renderer.js';

// stdout에 데이터를 쓰고 flush가 완료된 후 resolve하는 헬퍼
// process.stdout.write()는 파이프 환경(non-TTY)에서 비동기이므로,
// process.exit() 전에 write 콜백을 기다려야 데이터 유실을 방지할 수 있음
function stdoutWrite(data: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write(data, () => resolve());
  });
}

// ─── ANSI 색상 (TTY일 때만 활성화) ─────────────────────────

const isTTY = process.stdout.isTTY ?? false;
const isErrTTY = process.stderr.isTTY ?? false;

const c = picocolors.createColors(picocolors.isColorSupported && isTTY);
const ce = picocolors.createColors(picocolors.isColorSupported && isErrTTY);

// ─── 인자 파싱 ────────────────────────────────────────────

const VALID_CLIS = ['gemini', 'claude', 'codex'] as const;
const VALID_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    options: {
      cli: { type: 'string', short: 'c' },
      session: { type: 'string', short: 's' },
      model: { type: 'string', short: 'm' },
      effort: { type: 'string', short: 'e' },
      cwd: { type: 'string', short: 'd' },
      direct: { type: 'boolean', short: 'D', default: false },
      yolo: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'list-models': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
} catch (err) {
  process.stderr.write(`${ce.red('오류')}: ${(err as Error).message}\n`);
  process.stderr.write(`도움말: unified-agent --help\n`);
  process.exit(1);
}

const { values, positionals } = parsed;

// ─── 도움말 ──────────────────────────────────────────────

if (values.help) {
  const help = `
${c.bold('unified-agent')} — Gemini, Claude, Codex 통합 CLI

${c.bold('사용법')}
  unified-agent [옵션] <프롬프트>
  echo "프롬프트" | unified-agent [옵션]

${c.bold('옵션')}
  -c, --cli <name>      CLI 선택 (gemini | claude | codex)
  -s, --session <id>    이전 세션 재개 (사용 시 -c 필수)
  -m, --model <name>    모델 지정
  -e, --effort <level>  reasoning effort (none | low | medium | high | xhigh)
  -d, --cwd <path>      작업 디렉토리 (기본: 현재 디렉토리)
  -D, --direct           Direct 모드 (ACP 우회, CLI 직접 실행)
      --yolo             자동 권한 승인 모드
      --json             JSON 출력
      --list-models      사용 가능한 모델 목록 출력
  -h, --help             도움말

${c.bold('예시')}
  ${c.dim('# 자동 감지된 CLI로 실행')}
  unified-agent "이 프로젝트를 분석해줘"

  ${c.dim('# Claude로 실행, 모델 지정')}
  unified-agent -c claude -m opus "코드를 리뷰해줘"

  ${c.dim('# Codex로 실행, reasoning effort 설정')}
  unified-agent -c codex -e high "버그를 찾아줘"

  ${c.dim('# stdin 파이프')}
  cat error.log | unified-agent -c gemini "이 에러를 분석해줘"

  ${c.dim('# 이전 세션 재개')}
  unified-agent -c claude -s <sessionId> "이어서 설명해줘"

  ${c.dim('# JSON 출력 (스크립트에서 파싱 용도)')}
  unified-agent --json -c claude "요약해줘" | jq .response
`;
  process.stdout.write(help.trimStart());
  process.exit(0);
}

// ─── 모델 목록 출력 ──────────────────────────────────────

if (values['list-models']) {
  const cliFilter = values.cli as string | undefined;
  const jsonOut = values.json as boolean;
  const registry = getModelsRegistry();

  // 출력 대상 프로바이더 결정
  const providerKeys = cliFilter
    ? [cliFilter]
    : Object.keys(registry.providers);

  if (cliFilter && !registry.providers[cliFilter]) {
    process.stderr.write(
      `${ce.red('오류')}: 알 수 없는 CLI "${cliFilter}". 사용 가능: ${Object.keys(registry.providers).join(', ')}\n`,
    );
    process.exit(1);
  }

  if (jsonOut) {
    // JSON 모드: 필터된 레지스트리 출력
    const filtered = cliFilter
      ? { [cliFilter]: registry.providers[cliFilter] }
      : registry.providers;
    process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
  } else {
    // TTY: 테이블 형태 출력
    for (const key of providerKeys) {
      const provider = getProviderModels(key as CliType);
      process.stdout.write(`\n${c.bold(provider.name)} ${c.dim(`(${key})`)}\n`);
      process.stdout.write(`${c.dim('기본 모델:')} ${provider.defaultModel}\n`);

      if (provider.reasoningEffort.supported) {
        process.stdout.write(
          `${c.dim('reasoning effort:')} ${provider.reasoningEffort.levels.join(', ')} ${c.dim(`(기본: ${provider.reasoningEffort.default})`)}\n`,
        );
      }

      process.stdout.write('\n');
      for (const model of provider.models) {
        const isDefault = model.modelId === provider.defaultModel;
        const marker = isDefault ? c.green('*') : ' ';
        process.stdout.write(`  ${marker} ${c.cyan(model.modelId)}  ${c.dim(model.name)}\n`);
      }
    }
    process.stdout.write('\n');
  }

  process.exit(0);
}

// ─── 옵션 검증 ──────────────────────────────────────────

const cliOpt = values.cli as string | undefined;
if (cliOpt && !VALID_CLIS.includes(cliOpt as CliType)) {
  process.stderr.write(
    `${ce.red('오류')}: 알 수 없는 CLI "${cliOpt}". 사용 가능: ${VALID_CLIS.join(', ')}\n`,
  );
  process.exit(1);
}

const rawSessionOpt = values.session as string | undefined;
const sessionOpt = rawSessionOpt?.trim();
if (rawSessionOpt !== undefined && !sessionOpt) {
  process.stderr.write(`${ce.red('오류')}: --session 값은 비어 있을 수 없습니다.\n`);
  process.exit(1);
}

if (sessionOpt && !cliOpt) {
  process.stderr.write(`${ce.red('오류')}: --session 사용 시 --cli를 함께 지정해야 합니다.\n`);
  process.exit(1);
}

const effortOpt = values.effort as string | undefined;
if (effortOpt && !VALID_EFFORTS.includes(effortOpt as (typeof VALID_EFFORTS)[number])) {
  process.stderr.write(
    `${ce.red('오류')}: 알 수 없는 effort "${effortOpt}". 사용 가능: ${VALID_EFFORTS.join(', ')}\n`,
  );
  process.exit(1);
}

// ─── 프롬프트 읽기 ──────────────────────────────────────

let prompt = positionals.join(' ');

if (!prompt && !process.stdin.isTTY) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  prompt = Buffer.concat(chunks).toString().trim();
}

if (!prompt) {
  process.stderr.write(`${ce.red('오류')}: 프롬프트를 입력해주세요.\n`);
  process.stderr.write(`도움말: unified-agent --help\n`);
  process.exit(1);
}

// ─── 실행 ──────────────────────────────────────────────

const jsonMode = values.json as boolean;
const startTime = Date.now();

const selectedCli = cliOpt as CliType | undefined;
const directMode = values.direct as boolean;

// ─── 통합 실행 (ACP + Direct) ────────────────────────────

const client = new UnifiedAgentClient();
const renderer = new CliRenderer({ color: c, colorErr: ce });
let fullResponse = '';
let isLivePrompt = false;

// 이벤트 리스너 설정 (세션 재개 시 replay 이벤트는 무시)
client.on('messageChunk', (text) => {
  if (!isLivePrompt) return;
  fullResponse += text;
  if (!jsonMode) renderer.renderMessageChunk(text);
});

// error 리스너는 모드 무관하게 항상 등록 (미등록 시 Unhandled 'error' event crash)
client.on('error', (err) => {
  if (!jsonMode) renderer.renderError(err);
});

if (!jsonMode) {
  client.on('thoughtChunk', (text) => {
    if (!isLivePrompt) return;
    renderer.renderThoughtChunk(text);
  });

  client.on('toolCall', (title, status, _sid, data) => {
    if (!isLivePrompt) return;
    renderer.renderToolCall(title, status, data);
  });

  client.on('toolCallUpdate', (title, status, _sid, data) => {
    if (!isLivePrompt) return;
    renderer.renderToolCallUpdate(title, status, data);
  });
}

try {
  const cwd = (values.cwd as string) || process.cwd();

  if (!jsonMode) {
    const resumeLabel = sessionOpt ? `, resume: ${sessionOpt.slice(0, 8)}…` : '';
    const cliLabel = selectedCli ?? '자동 감지';
    renderer.renderHeader(cliLabel, directMode, resumeLabel);
  }

  const result = await client.connect({
    cwd,
    cli: selectedCli,
    direct: directMode,
    autoApprove: true,
    yoloMode: values.yolo as boolean,
    model: values.model as string | undefined,
    effort: effortOpt,
    sessionId: sessionOpt,
  });

  // reasoning effort 설정 (direct 모드에서는 connect 시 args에 포함됨)
  if (effortOpt && result.protocol === 'acp') {
    try {
      await client.setConfigOption('reasoning_effort', effortOpt);
    } catch {
      // reasoning_effort 미지원 CLI인 경우 무시
    }
  }

  if (!jsonMode) {
    // 헤더에 실제 연결된 CLI 표시 (자동 감지된 경우)
    if (!selectedCli) {
      renderer.renderAutoDetected(result.cli);
    }
  }

  // 세션 로드 중 재생된 이벤트 무시 후, 현재 프롬프트부터 출력 시작
  fullResponse = '';
  isLivePrompt = true;

  await client.sendMessage(prompt);

  if (!jsonMode) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const sid = client.getConnectionInfo().sessionId;
    renderer.renderComplete(elapsed, sid);
  }

  if (jsonMode) {
    const sid = client.getConnectionInfo().sessionId;
    await stdoutWrite(
      JSON.stringify({ response: fullResponse, cli: result.cli, sessionId: sid }) + '\n',
    );
  }
} catch (err) {
  const sid = client.getConnectionInfo().sessionId;
  if (!jsonMode) {
    const sessionInfo = sid ? ` ${ce.dim(`(세션: ${sid})`)}` : '';
    process.stderr.write(`\n${ce.red('오류')}: ${(err as Error).message}${sessionInfo}\n`);
  } else {
    await stdoutWrite(
      JSON.stringify({ error: (err as Error).message, sessionId: sid ?? null }) + '\n',
    );
  }
  process.exitCode = 1;
} finally {
  await client.disconnect();
  process.exit(process.exitCode ?? 0);
}
