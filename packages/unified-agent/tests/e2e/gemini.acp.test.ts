/**
 * E2E: Gemini ACP 테스트
 * Gemini CLI를 ACP 프로토콜로 연결하여 프롬프트, 모델, 세션 재개를 검증합니다.
 * Gemini는 reasoning effort를 지원하지 않으므로 effort 테스트는 없습니다.
 *
 * 주의: gemini-3.1-pro-preview는 서버 용량 부족(429)이 빈번하므로
 * 기본 모델을 gemini-3-flash-preview로 고정합니다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isCliInstalled,
  connectClient,
  sendAndCollect,
  runCli,
  withTimeout,
  SIMPLE_PROMPT,
  SESSION_REMEMBER_PROMPT,
  SESSION_RECALL_PROMPT,
} from './helpers.js';
import { getProcessPool } from '../../src/index.js';
import type { UnifiedAgentClient } from '../../src/index.js';
import type { CliJsonResult } from './helpers.js';

const CLI = 'gemini';
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const installed = isCliInstalled(CLI);

describe.skipIf(!installed)('E2E: Gemini ACP', () => {
  let client: UnifiedAgentClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  // ═══════════════════════════════════════════════
  // 기본 연결 & 프롬프트
  // ═══════════════════════════════════════════════

  describe('기본 연결 & 프롬프트', () => {
    it('SDK: ACP 연결 → 프롬프트 → 응답 검증', async () => {
      const { client: c, sessionId } = await connectClient('gemini', { model: DEFAULT_MODEL });
      client = c;

      expect(sessionId).toBeTruthy();

      const { response } = await sendAndCollect(client, SIMPLE_PROMPT);
      expect(response).toContain('2');
    }, 180_000);

    it('CLI: pretty 모드 프롬프트', async () => {
      const { stdout, stderr, exitCode } = await runCli(
        ['-c', 'gemini', '-m', DEFAULT_MODEL, SIMPLE_PROMPT],
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('2');
      expect(stderr).toContain('unified-agent');
    }, 180_000);

    it('CLI: JSON 모드 프롬프트', async () => {
      const { stdout, exitCode } = await runCli(
        ['--json', '-c', 'gemini', '-m', DEFAULT_MODEL, SIMPLE_PROMPT],
      );

      expect(exitCode).toBe(0);
      const result: CliJsonResult = JSON.parse(stdout.trim());
      expect(result.response).toContain('2');
      expect(result.cli).toBe('gemini');
      expect(result.sessionId.length).toBeGreaterThan(0);
    }, 180_000);
  });

  // ═══════════════════════════════════════════════
  // Disconnect 후 프로세스 종료
  // ═══════════════════════════════════════════════

  describe('Disconnect 후 프로세스 종료', () => {
    it('SDK: 연결 → 프롬프트 → disconnect → 프로세스 종료 및 상태 초기화 검증', async () => {
      // 최소 모델로 연결 (Gemini는 effort 미지원)
      const { client: c, sessionId } = await connectClient('gemini', { model: DEFAULT_MODEL });
      client = c;
      expect(sessionId).toBeTruthy();

      // 프롬프트 전송 → 정상 응답 확인
      const { response } = await sendAndCollect(client, SIMPLE_PROMPT);
      expect(response).toContain('2');

      // disconnect → 프로세스를 Pool에 반환 (Claude/Codex) 또는 kill (Gemini)
      await client.disconnect();

      // 연결 상태 초기화 확인
      const info = client.getConnectionInfo();
      expect(info.state).toBe('disconnected');
      expect(info.cli).toBeNull();
      expect(info.sessionId).toBeNull();

      // 재전송 시 에러 발생 확인
      await expect(client.sendMessage(SIMPLE_PROMPT)).rejects.toThrow();

      // Pool에 반환된 프로세스 정리
      await getProcessPool().drain();

      client = null;
    }, 180_000);
  });

  // ═══════════════════════════════════════════════
  // 모델별 프롬프트
  // Gemini는 set_config_option 미지원 → spawn 시 --model 인자로 전달
  // ═══════════════════════════════════════════════

  describe('모델별 프롬프트', () => {
    it.each(['gemini-3-flash-preview'])(
      'CLI: 모델 %s → 프롬프트 → 응답 검증',
      async (model) => {
        const { stdout, exitCode } = await runCli(
          ['--json', '-c', 'gemini', '-m', model, SIMPLE_PROMPT],
        );

        expect(exitCode).toBe(0);
        const result: CliJsonResult = JSON.parse(stdout.trim());
        expect(result.response).toContain('2');
        expect(result.cli).toBe('gemini');
      },
      180_000,
    );
  });

  // ═══════════════════════════════════════════════
  // 세션 재개
  // ═══════════════════════════════════════════════

  describe('세션 재개', () => {
    it('CLI: 1차 프롬프트 → sessionId → 2차 세션 재개 → 컨텍스트 유지', async () => {
      // 1차: 숫자 기억 요청 (flash 모델 고정)
      const first = await runCli(
        ['--json', '-c', 'gemini', '-m', DEFAULT_MODEL, SESSION_REMEMBER_PROMPT],
      );
      expect(first.exitCode).toBe(0);

      const firstResult: CliJsonResult = JSON.parse(first.stdout.trim());
      expect(firstResult.sessionId.length).toBeGreaterThan(0);

      // 2차: 세션 재개하여 기억한 숫자 확인
      const second = await runCli(
        ['--json', '-c', 'gemini', '-m', DEFAULT_MODEL, '-s', firstResult.sessionId, SESSION_RECALL_PROMPT],
        { timeout: 360_000 },
      );
      expect(second.exitCode).toBe(0);

      const secondResult: CliJsonResult = JSON.parse(second.stdout.trim());
      expect(secondResult.response).toContain('42');
      expect(secondResult.sessionId).toBe(firstResult.sessionId);
    }, 360_000);
  });
});
