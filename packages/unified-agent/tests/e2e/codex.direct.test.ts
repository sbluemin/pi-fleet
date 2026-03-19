/**
 * E2E: Codex Direct 테스트
 * Codex CLI를 Direct 모드(-D)로 실행하여 프롬프트, 모델, effort, 세션 재개를 검증합니다.
 * Direct 모드는 ACP를 우회하고 `codex exec` 명령을 직접 실행합니다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isCliInstalled,
  connectClient,
  sendAndCollect,
  runCli,
  SIMPLE_PROMPT,
  SESSION_REMEMBER_PROMPT,
  SESSION_RECALL_PROMPT,
} from './helpers.js';
import type { UnifiedAgentClient } from '../../src/index.js';
import type { CliJsonResult } from './helpers.js';

const CLI = 'codex';
const installed = isCliInstalled(CLI);

describe.skipIf(!installed)('E2E: Codex Direct', () => {
  let client: UnifiedAgentClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  // ═══════════════════════════════════════════════
  // 기본 프롬프트
  // ═══════════════════════════════════════════════

  describe('기본 프롬프트', () => {
    it('SDK: direct 모드 연결 → 프롬프트 → 응답 검증', async () => {
      const { client: c } = await connectClient('codex', { direct: true });
      client = c;

      const { response } = await sendAndCollect(client, SIMPLE_PROMPT);
      expect(response).toContain('2');
    }, 180_000);

    it('CLI: JSON 모드 (-D 플래그)', async () => {
      const { stdout, exitCode } = await runCli(
        ['--json', '-c', 'codex', '-D', SIMPLE_PROMPT],
      );

      expect(exitCode).toBe(0);
      const result: CliJsonResult = JSON.parse(stdout.trim());
      expect(result.response).toContain('2');
      expect(result.cli).toBe('codex');
    }, 180_000);
  });

  // ═══════════════════════════════════════════════
  // Disconnect 후 상태 초기화
  // ═══════════════════════════════════════════════

  describe('Disconnect 후 상태 초기화', () => {
    it('SDK: 연결 → 프롬프트 → disconnect → 상태 초기화 검증', async () => {
      // 최소 모델로 연결 (Direct 모드)
      const { client: c } = await connectClient('codex', { direct: true, model: 'gpt-5.3-codex-spark' });
      client = c;

      // 프롬프트 전송 → 정상 응답 확인
      const { response } = await sendAndCollect(client, SIMPLE_PROMPT);
      expect(response).toContain('2');

      // disconnect → 상태 초기화
      await client.disconnect();

      // 연결 상태 초기화 확인
      const info = client.getConnectionInfo();
      expect(info.state).toBe('disconnected');
      expect(info.cli).toBeNull();
      expect(info.sessionId).toBeNull();

      // 재전송 시 에러 발생 확인
      await expect(client.sendMessage(SIMPLE_PROMPT)).rejects.toThrow();

      client = null;
    }, 180_000);
  });

  // ═══════════════════════════════════════════════
  // 모델별 프롬프트
  // ═══════════════════════════════════════════════

  describe('모델별 프롬프트', () => {
    it.each(['gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4'])(
      'CLI: 모델 %s → 프롬프트 → 응답 검증',
      async (model) => {
        const { stdout, exitCode } = await runCli(
          ['--json', '-c', 'codex', '-D', '-m', model, SIMPLE_PROMPT],
        );

        expect(exitCode).toBe(0);
        const result: CliJsonResult = JSON.parse(stdout.trim());
        expect(result.response).toContain('2');
        expect(result.cli).toBe('codex');
      },
      180_000,
    );
  });

  // ═══════════════════════════════════════════════
  // Reasoning effort
  // ═══════════════════════════════════════════════

  describe('Reasoning effort', () => {
    it.each(['none', 'low', 'medium', 'high', 'xhigh'])(
      'CLI: effort %s → 프롬프트 → 응답 검증',
      async (effort) => {
        const { stdout, exitCode } = await runCli(
          ['--json', '-c', 'codex', '-D', '-e', effort, SIMPLE_PROMPT],
        );

        expect(exitCode).toBe(0);
        const result: CliJsonResult = JSON.parse(stdout.trim());
        expect(result.response).toContain('2');
        expect(result.cli).toBe('codex');
      },
      180_000,
    );
  });

  // ═══════════════════════════════════════════════
  // 세션 재개
  // ═══════════════════════════════════════════════

  describe('세션 재개', () => {
    it('CLI: 1차(-D) → sessionId → 2차(-D -s) → 컨텍스트 유지', async () => {
      // 1차: 숫자 기억 요청
      const first = await runCli(
        ['--json', '-c', 'codex', '-D', SESSION_REMEMBER_PROMPT],
      );
      expect(first.exitCode).toBe(0);

      const firstResult: CliJsonResult = JSON.parse(first.stdout.trim());
      expect(firstResult.sessionId.length).toBeGreaterThan(0);

      // 2차: 세션 재개하여 기억한 숫자 확인
      const second = await runCli(
        ['--json', '-c', 'codex', '-D', '-s', firstResult.sessionId, SESSION_RECALL_PROMPT],
        { timeout: 360_000 },
      );
      expect(second.exitCode).toBe(0);

      const secondResult: CliJsonResult = JSON.parse(second.stdout.trim());
      expect(secondResult.response).toContain('42');
      expect(secondResult.sessionId).toBe(firstResult.sessionId);
    }, 360_000);
  });
});
