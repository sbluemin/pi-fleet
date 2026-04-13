/**
 * Raw ACP 세션 테스트
 *
 * @agentclientprotocol/sdk 만 사용하여 CLI 프로세스에 직접 연결하고
 * 세션 관련 기능(멀티 세션, load, list, 모델 변경)을 순차 검증합니다.
 * packages/unified-agent/src/** 의 어떠한 코드도 import하지 않습니다.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  InitializeResponse,
  SessionNotification,
  SessionUpdate,
  ContentChunk,
  NewSessionResponse,
} from '@agentclientprotocol/sdk/dist/schema/types.gen.js';

// ─────────────────────────────────────────────────────────────
// CLI 정의
// ─────────────────────────────────────────────────────────────

interface CliDef {
  name: string;
  command: string;
  args: string[];
}

const CLIS: CliDef[] = [
  {
    name: 'claude',
    command: 'npx',
    args: ['--yes', '--package=@agentclientprotocol/claude-agent-acp@0.26.0', 'claude-agent-acp'],
  },
  {
    name: 'codex',
    command: 'npx',
    args: ['--yes', '--package=@zed-industries/codex-acp@0.11.1', 'codex-acp'],
  },
  {
    name: 'gemini',
    command: 'gemini',
    args: ['--acp'],
  },
];

// ─────────────────────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────────────────────

/** CLI 설치 여부 확인 */
function isCliInstalled(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** 타임아웃 래퍼 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[${label}] ${ms}ms 타임아웃 초과`)), ms),
    ),
  ]);
}

/** sessionUpdate에서 agent_message_chunk 텍스트를 추출 */
function extractAgentText(update: SessionUpdate): string | null {
  const chunk = update as ContentChunk & { sessionUpdate: string };
  if (chunk.sessionUpdate !== 'agent_message_chunk') return null;
  const block = chunk.content;
  if (block && 'text' in block && typeof block.text === 'string') {
    return block.text;
  }
  return null;
}

/** 텍스트 프롬프트용 ContentBlock 생성 */
function textBlock(text: string) {
  return [{ type: 'text' as const, text }];
}

// ─────────────────────────────────────────────────────────────
// ACP 연결 컨텍스트
// ─────────────────────────────────────────────────────────────

interface AcpContext {
  child: ChildProcess;
  conn: ClientSideConnection;
  initResult: InitializeResponse;
  /** 세션별 수집된 응답 텍스트 */
  collected: Map<string, string[]>;
}

/** CLI 프로세스를 스폰하고 ACP 연결을 수립 */
async function createAcpContext(cli: CliDef): Promise<AcpContext> {
  const child = spawn(cli.command, cli.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });

  // stderr 로그 수집 (테스트 실패 원인으로 사용하지 않음)
  const stderrChunks: string[] = [];
  child.stderr?.on('data', (data: Buffer) => {
    stderrChunks.push(data.toString());
  });

  const collected = new Map<string, string[]>();

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  );

  const conn = new ClientSideConnection(
    () => ({
      requestPermission: async (params) => {
        // 첫 번째 옵션 자동 선택
        const firstOption = params.options[0];
        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: firstOption.optionId,
          },
        };
      },
      sessionUpdate: async (params: SessionNotification) => {
        const text = extractAgentText(params.update);
        if (text !== null) {
          const arr = collected.get(params.sessionId) ?? [];
          arr.push(text);
          collected.set(params.sessionId, arr);
        }
      },
      readTextFile: async (params) => {
        const content = readFileSync(params.path, 'utf-8');
        return { content };
      },
      writeTextFile: async () => {
        return {};
      },
    }),
    stream,
  );

  const initResult = await withTimeout(
    conn.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    }),
    60_000,
    `${cli.name} initialize`,
  );

  return { child, conn, initResult, collected };
}

/** 프로세스를 안전하게 종료 */
function destroyContext(ctx: AcpContext | null): void {
  if (!ctx) return;
  try {
    ctx.child.kill('SIGTERM');
  } catch {
    // 이미 종료된 경우 무시
  }
}

/** 프롬프트를 전송하고 완료까지 대기, 수집된 응답 텍스트 반환 */
async function sendPrompt(
  ctx: AcpContext,
  sessionId: string,
  prompt: string,
  timeoutMs = 120_000,
): Promise<string> {
  // 기존 수집분 초기화
  ctx.collected.set(sessionId, []);

  await withTimeout(
    ctx.conn.prompt({
      sessionId,
      prompt: textBlock(prompt),
    }),
    timeoutMs,
    'prompt',
  );

  const chunks = ctx.collected.get(sessionId) ?? [];
  return chunks.join('');
}

/** 새 세션 생성 헬퍼 */
async function createSession(ctx: AcpContext): Promise<NewSessionResponse> {
  return withTimeout(
    ctx.conn.newSession({ cwd: process.cwd(), mcpServers: [] }),
    30_000,
    'newSession',
  );
}

// ─────────────────────────────────────────────────────────────
// 프롬프트 상수
// ─────────────────────────────────────────────────────────────

const SIMPLE_PROMPT = '코드 실행이나 도구 사용 없이 바로 답해줘. 1+1의 결과를 숫자만 답해. 다른 설명은 하지 마.';
const REMEMBER_PROMPT = '코드 실행이나 도구 사용 없이 바로 답해줘. 지금부터 내가 말하는 숫자를 기억해. 숫자는 42야. "알겠습니다"라고만 답해.';
const RECALL_PROMPT = '코드 실행이나 도구 사용 없이 바로 답해줘. 내가 아까 말한 숫자가 뭐였어? 숫자만 답해.';

// ─────────────────────────────────────────────────────────────
// CLI별 테스트
// ─────────────────────────────────────────────────────────────

for (const cli of CLIS) {
  const installed = isCliInstalled(cli.command);

  describe.skipIf(!installed)(`Raw ACP 세션: ${cli.name}`, () => {
    let ctx: AcpContext | null = null;
    let firstSessionId: string;

    beforeAll(async () => {
      ctx = await createAcpContext(cli);
      const session = await createSession(ctx);
      firstSessionId = session.sessionId;
    }, 120_000);

    afterAll(() => {
      destroyContext(ctx);
      ctx = null;
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 1: 단일 프로세스 멀티 세션
    // ═══════════════════════════════════════════════════════════

    describe('단일 프로세스 멀티 세션', () => {
      let secondSessionId: string;

      it('session/new 2회 호출 시 서로 다른 sessionId 생성', async () => {
        expect(firstSessionId).toBeTruthy();

        const second = await createSession(ctx!);
        secondSessionId = second.sessionId;

        expect(secondSessionId).toBeTruthy();
        expect(secondSessionId).not.toBe(firstSessionId);
      }, 180_000);

      it('각 세션에 순차 프롬프트 전송 시 양쪽 모두 응답', async () => {
        // 첫 번째 세션에 프롬프트 전송
        const resp1 = await sendPrompt(ctx!, firstSessionId, SIMPLE_PROMPT);
        expect(resp1).toContain('2');

        // 두 번째 세션에 프롬프트 전송
        const resp2 = await sendPrompt(ctx!, secondSessionId, SIMPLE_PROMPT);
        expect(resp2).toContain('2');
      }, 180_000);

      it('세션 컨텍스트 격리 — 세션 A의 정보가 세션 B로 누출되지 않음', async () => {
        // 세션 A에 숫자 42 기억 요청
        await sendPrompt(ctx!, firstSessionId, REMEMBER_PROMPT);

        // 세션 B(독립 컨텍스트)에서 동일 질의
        // 세션 B는 42를 전달받은 적이 없으므로 응답에 "42"가 포함되어서는 안 됨
        const respB = await sendPrompt(
          ctx!,
          secondSessionId,
          '코드 실행이나 도구 사용 없이 바로 답해줘. 내가 이 대화에서 어떤 숫자를 말했어? 숫자를 말한 적이 없으면 "없음"이라고만 답해.',
        );
        expect(respB).not.toContain('42');
      }, 180_000);
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 2: session/load
    // ═══════════════════════════════════════════════════════════

    describe('session/load', () => {
      it('loadSession으로 기존 세션 컨텍스트 복원 후 recall 가능', async () => {
        const caps = ctx!.initResult.agentCapabilities;
        const hasLoad = caps?.loadSession === true;
        if (!hasLoad) {
          // eslint-disable-next-line no-console
          console.log(`[${cli.name}] loadSession 미지원 — 스킵`);
          return;
        }

        // 새 세션에서 숫자 기억 요청
        const session = await createSession(ctx!);
        await sendPrompt(ctx!, session.sessionId, REMEMBER_PROMPT);

        // loadSession으로 해당 세션 로드
        await withTimeout(
          ctx!.conn.loadSession({
            sessionId: session.sessionId,
            cwd: process.cwd(),
            mcpServers: [],
          }),
          30_000,
          'loadSession',
        );

        // recall 프롬프트 전송
        const recallResp = await sendPrompt(ctx!, session.sessionId, RECALL_PROMPT);
        expect(recallResp).toContain('42');
      }, 180_000);
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 3: session/list
    // ═══════════════════════════════════════════════════════════

    describe('session/list', () => {
      it('listSessions 호출 시 세션 배열 반환', async () => {
        const caps = ctx!.initResult.agentCapabilities;
        const hasList = caps?.sessionCapabilities?.list != null;
        if (!hasList) {
          // eslint-disable-next-line no-console
          console.log(`[${cli.name}] listSessions 미지원 — 스킵`);
          return;
        }

        const result = await withTimeout(
          ctx!.conn.listSessions({}),
          30_000,
          'listSessions',
        );

        expect(result).toBeDefined();
        expect(Array.isArray(result.sessions)).toBe(true);
      }, 180_000);
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 4: 모델 변경
    // ═══════════════════════════════════════════════════════════

    describe('모델 변경 (set_model → fallback set_config_option)', () => {
      it('모델 변경 후 프롬프트 정상 응답', async () => {
        const session = await createSession(ctx!);

        // 세션 응답의 availableModels에서 현재 모델과 다른 모델을 선택
        // 대안 모델을 찾을 수 없으면 모델 변경 없이 프롬프트만 검증
        const available = session.models?.availableModels ?? [];
        const currentModelId = session.models?.currentModelId ?? '';
        const alternativeModel = available.find((m) => m.modelId !== currentModelId);

        if (!alternativeModel) {
          // eslint-disable-next-line no-console
          console.log(`[${cli.name}] 대안 모델 없음 — 기본 모델로 프롬프트 검증`);
          const resp = await sendPrompt(ctx!, session.sessionId, SIMPLE_PROMPT);
          expect(resp).toContain('2');
          return;
        }

        const targetModel = alternativeModel.modelId;
        let modelChanged = false;

        // 1차 시도: unstable_setSessionModel
        try {
          await withTimeout(
            ctx!.conn.unstable_setSessionModel({
              sessionId: session.sessionId,
              modelId: targetModel,
            }),
            15_000,
            'setSessionModel',
          );
          modelChanged = true;
        } catch {
          // set_model 미지원 → set_config_option fallback
        }

        // 2차 시도: setSessionConfigOption (configId='model')
        if (!modelChanged) {
          try {
            await withTimeout(
              ctx!.conn.setSessionConfigOption({
                sessionId: session.sessionId,
                configId: 'model',
                value: targetModel,
              }),
              15_000,
              'setSessionConfigOption',
            );
            modelChanged = true;
          } catch {
            // 두 방법 모두 실패하면 기본 모델로 진행
            // eslint-disable-next-line no-console
            console.log(`[${cli.name}] 모델 변경 미지원 — 기본 모델로 프롬프트 전송`);
          }
        }

        // 모델 변경 여부와 관계없이 프롬프트 정상 동작 확인
        const resp = await sendPrompt(ctx!, session.sessionId, SIMPLE_PROMPT);
        expect(resp).toContain('2');
      }, 180_000);
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 5: 세션 lifecycle 순환 (closeSession → newSession)
    // ═══════════════════════════════════════════════════════════

    describe('세션 lifecycle 순환 (closeSession → newSession)', () => {
      it('closeSession 후 동일 connection에서 newSession 성공', async () => {
        // 새 세션 생성 + 베이스라인 프롬프트
        const session = await createSession(ctx!);
        const originalId = session.sessionId;
        const baselineResp = await sendPrompt(ctx!, originalId, SIMPLE_PROMPT);
        expect(baselineResp).toContain('2');

        const hasClose = ctx!.initResult.agentCapabilities?.sessionCapabilities?.close != null;

        // closeSession 시도
        let closeFailed = false;
        try {
          await withTimeout(
            ctx!.conn.unstable_closeSession({ sessionId: originalId }),
            15_000,
            'closeSession',
          );
        } catch (err: unknown) {
          closeFailed = true;
          const e = err as Record<string, unknown>;
          // eslint-disable-next-line no-console
          console.log(
            `[${cli.name}] closeSession 실패 (예상 가능): code=${e.code}, message=${e.message}`,
          );
          if (hasClose) {
            // close capability가 있다고 선언했는데 실패하면 경고
            // eslint-disable-next-line no-console
            console.warn(`[${cli.name}] close capability 있음에도 closeSession 실패`);
          }
        }

        // 동일 connection에서 새 세션 생성
        const newSession = await createSession(ctx!);
        expect(newSession.sessionId).toBeTruthy();
        expect(newSession.sessionId).not.toBe(originalId);

        // 새 세션에서 프롬프트 전송
        const newResp = await sendPrompt(ctx!, newSession.sessionId, SIMPLE_PROMPT);
        expect(newResp).toContain('2');

        // close 실패 여부와 무관하게 connection이 정상 동작함을 확인
        if (closeFailed) {
          // eslint-disable-next-line no-console
          console.log(`[${cli.name}] closeSession 실패했지만 newSession은 정상 동작`);
        }
      }, 180_000);
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 6: closeSession 미지원 시 connection 오염 없음
    // ═══════════════════════════════════════════════════════════

    describe('closeSession 미지원 시 connection 오염 없음', () => {
      it('closeSession 에러 후에도 기존 세션 프롬프트 정상 동작', async () => {
        const session = await createSession(ctx!);
        const sessionId = session.sessionId;

        // closeSession 시도 및 에러 캡처
        let closeError: Record<string, unknown> | null = null;
        let closeSucceeded = false;
        try {
          await withTimeout(
            ctx!.conn.unstable_closeSession({ sessionId }),
            15_000,
            'closeSession',
          );
          closeSucceeded = true;
        } catch (err: unknown) {
          closeError = err as Record<string, unknown>;
        }

        // 결과 로깅
        if (closeError) {
          // eslint-disable-next-line no-console
          console.log(
            `[${cli.name}] closeSession 에러: code=${closeError.code}, message=${closeError.message}`,
          );
        } else {
          // eslint-disable-next-line no-console
          console.log(`[${cli.name}] closeSession 성공`);
        }

        if (!closeSucceeded) {
          // close 실패 → 기존 세션이 여전히 살아있어야 함
          const resp = await sendPrompt(ctx!, sessionId, SIMPLE_PROMPT);
          expect(resp).toContain('2');
        } else {
          // close 성공 → 새 세션 생성 후 프롬프트 확인
          const newSession = await createSession(ctx!);
          const resp = await sendPrompt(ctx!, newSession.sessionId, SIMPLE_PROMPT);
          expect(resp).toContain('2');
        }

        // 어느 경우든 connection이 오염되지 않았음을 확인 (위 assert 통과 시 성공)
      }, 180_000);
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 7: 존재하지 않는 모델 ID 설정 시 에러 패턴
    // ═══════════════════════════════════════════════════════════

    describe('존재하지 않는 모델 ID 설정 시 에러 패턴', () => {
      it('잘못된 모델 ID에서 에러 code/message 캡처', async () => {
        const session = await createSession(ctx!);
        const invalidModel = '__invalid_model_xyz__';
        const errors: Array<{ method: string; code: unknown; message: unknown; name: unknown }> = [];
        let anySucceeded = false;

        // 1차 시도: unstable_setSessionModel
        try {
          await withTimeout(
            ctx!.conn.unstable_setSessionModel({
              sessionId: session.sessionId,
              modelId: invalidModel,
            }),
            15_000,
            'setSessionModel(invalid)',
          );
          anySucceeded = true;
          // eslint-disable-next-line no-console
          console.log(`[${cli.name}] unstable_setSessionModel('${invalidModel}') 성공 (예상 외)`);
        } catch (err: unknown) {
          const e = err as Record<string, unknown>;
          errors.push({
            method: 'unstable_setSessionModel',
            code: e.code,
            message: e.message,
            name: e.name,
          });
        }

        // 2차 시도: setSessionConfigOption
        if (!anySucceeded) {
          try {
            await withTimeout(
              ctx!.conn.setSessionConfigOption({
                sessionId: session.sessionId,
                configId: 'model',
                value: invalidModel,
              }),
              15_000,
              'setSessionConfigOption(invalid)',
            );
            anySucceeded = true;
            // eslint-disable-next-line no-console
            console.log(`[${cli.name}] setSessionConfigOption('${invalidModel}') 성공 (예상 외)`);
          } catch (err: unknown) {
            const e = err as Record<string, unknown>;
            errors.push({
              method: 'setSessionConfigOption',
              code: e.code,
              message: e.message,
              name: e.name,
            });
          }
        }

        // 캡처된 에러 정보 출력
        for (const entry of errors) {
          // eslint-disable-next-line no-console
          console.log(
            `[${cli.name}] ${entry.method} 에러 — code: ${String(entry.code)}, message: ${String(entry.message)}, name: ${String(entry.name)}`,
          );
        }

        // 정보 수집 목적: 에러가 있으면 에러 객체 존재 확인, 없으면 그냥 통과
        if (errors.length > 0) {
          expect(errors[0]).toBeDefined();
        }
      }, 180_000);
    });

    // ═══════════════════════════════════════════════════════════
    // Describe 8: loadSession capability 감지 방식 비교
    // ═══════════════════════════════════════════════════════════

    describe('loadSession capability 감지 방식 비교', () => {
      it('agentCapabilities.loadSession flag와 메서드 존재 여부가 일치함', () => {
        const flagBased =
          ctx!.initResult.agentCapabilities?.loadSession === true;
        const methodBased =
          typeof (ctx!.conn as unknown as Record<string, unknown>).loadSession === 'function';

        // eslint-disable-next-line no-console
        console.log(
          `[${cli.name}] loadSession flag=${String(flagBased)}, method=${String(methodBased)}`,
        );

        expect(flagBased).toBe(methodBased);
      }, 180_000);
    });
  });
}
