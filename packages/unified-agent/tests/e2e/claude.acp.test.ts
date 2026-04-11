/**
 * E2E: Claude ACP 테스트
 * Claude CLI를 ACP 프로토콜로 연결하여 프롬프트, 모델, effort, 세션 재개를 검증합니다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isCliInstalled,
  probeCliModelAvailability,
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

const CLI = 'claude';
const installed = isCliInstalled(CLI);
const opus1mProbe = installed ? probeCliModelAvailability('claude', 'opus[1m]') : { available: false };

describe.skipIf(!installed)('E2E: Claude ACP', () => {
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
      const { client: c, sessionId } = await connectClient('claude');
      client = c;

      expect(sessionId).toBeTruthy();

      const { response } = await sendAndCollect(client, SIMPLE_PROMPT);
      expect(response).toContain('2');
    }, 180_000);

    it('CLI: pretty 모드 프롬프트', async () => {
      const { stdout, stderr, exitCode } = await runCli(
        ['-c', 'claude', SIMPLE_PROMPT],
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain('2');
      // stderr에 상태 헤더 포함
      expect(stderr).toContain('unified-agent');
    }, 180_000);

    it('CLI: JSON 모드 프롬프트', async () => {
      const { stdout, exitCode } = await runCli(
        ['--json', '-c', 'claude', SIMPLE_PROMPT],
      );

      expect(exitCode).toBe(0);
      const result: CliJsonResult = JSON.parse(stdout.trim());
      expect(result.response).toContain('2');
      expect(result.cli).toBe('claude');
      expect(result.sessionId.length).toBeGreaterThan(0);
    }, 180_000);
  });

  // ═══════════════════════════════════════════════
  // Disconnect 후 프로세스 종료
  // ═══════════════════════════════════════════════

  describe('Disconnect 후 프로세스 종료', () => {
    it('SDK: 연결 → 프롬프트 → disconnect → 프로세스 종료 및 상태 초기화 검증', async () => {
      // 최소 모델/effort로 연결
      const { client: c, sessionId } = await connectClient('claude', { model: 'haiku' });
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
  // ═══════════════════════════════════════════════

  describe('모델별 프롬프트', () => {
    it.each(['haiku', 'sonnet', 'opus'])(
      'CLI: 모델 %s → 프롬프트 → 응답 검증',
      async (model) => {
        const { stdout, exitCode } = await runCli(
          ['--json', '-c', 'claude', '-m', model, SIMPLE_PROMPT],
        );

        expect(exitCode).toBe(0);
        const result: CliJsonResult = JSON.parse(stdout.trim());
        expect(result.response).toContain('2');
        expect(result.cli).toBe('claude');
      },
      180_000,
    );

    it.skipIf(!opus1mProbe.available)(
      'CLI: 모델 opus[1m] → 프롬프트 → 응답 검증',
      async () => {
        const { stdout, exitCode } = await runCli(
          ['--json', '-c', 'claude', '-m', 'opus[1m]', SIMPLE_PROMPT],
        );

        expect(exitCode).toBe(0);
        const result: CliJsonResult = JSON.parse(stdout.trim());
        expect(result.response).toContain('2');
        expect(result.cli).toBe('claude');
      },
      180_000,
    );
  });

  // ═══════════════════════════════════════════════
  // Reasoning effort
  // ═══════════════════════════════════════════════

  describe('Reasoning effort', () => {
    it.each(['none', 'low', 'medium', 'high'])(
      'CLI: effort %s → 프롬프트 → 응답 검증',
      async (effort) => {
        const { stdout, exitCode } = await runCli(
          ['--json', '-c', 'claude', '-e', effort, SIMPLE_PROMPT],
        );

        expect(exitCode).toBe(0);
        const result: CliJsonResult = JSON.parse(stdout.trim());
        expect(result.response).toContain('2');
        expect(result.cli).toBe('claude');
      },
      180_000,
    );
  });

  // ═══════════════════════════════════════════════
  // 세션 재개
  // ═══════════════════════════════════════════════

  describe('세션 재개', () => {
    it('CLI: 1차 프롬프트 → sessionId → 2차 세션 재개 → 컨텍스트 유지', async () => {
      // 1차: 숫자 기억 요청
      const first = await runCli(
        ['--json', '-c', 'claude', SESSION_REMEMBER_PROMPT],
      );
      expect(first.exitCode).toBe(0);

      const firstResult: CliJsonResult = JSON.parse(first.stdout.trim());
      expect(firstResult.sessionId.length).toBeGreaterThan(0);

      // 2차: 세션 재개하여 기억한 숫자 확인
      const second = await runCli(
        ['--json', '-c', 'claude', '-s', firstResult.sessionId, SESSION_RECALL_PROMPT],
        { timeout: 360_000 },
      );
      expect(second.exitCode).toBe(0);

      const secondResult: CliJsonResult = JSON.parse(second.stdout.trim());
      expect(secondResult.response).toContain('42');
      expect(secondResult.sessionId).toBe(firstResult.sessionId);
    }, 360_000);
  });
});
