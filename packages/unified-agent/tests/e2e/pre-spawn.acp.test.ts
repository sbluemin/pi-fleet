/**
 * E2E: Pre-spawn ACP 테스트
 * preSpawn → connect, resetSession, consumed handle 에러를 검증합니다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isCliInstalled,
  connectClient,
  sendAndCollect,
  withTimeout,
  SIMPLE_PROMPT,
} from './helpers.js';
import { UnifiedAgentClient } from '../../src/index.js';
import type { CliType } from '../../src/types/config.js';

function runPreSpawnTests(cli: CliType) {
  describe(`E2E: Pre-spawn [${cli}]`, () => {
    let client: UnifiedAgentClient | null = null;

    afterEach(async () => {
      if (client) {
        await client.disconnect();
        client = null;
      }
    });

    it('preSpawn 후 connect → sendMessage → 응답 검증', async () => {
      client = new UnifiedAgentClient();
      client.on('error', () => {});

      const handle = await withTimeout(
        client.preSpawn(cli),
        60_000,
        `${cli} preSpawn`,
      );

      const result = await withTimeout(
        client.connect({
          preSpawned: handle,
          cwd: process.cwd(),
          autoApprove: true,
          clientInfo: { name: 'E2E-PreSpawn', version: '1.0.0' },
        }),
        120_000,
        `${cli} connect`,
      );

      expect(result.session?.sessionId).toBeTruthy();

      const { response } = await sendAndCollect(client, SIMPLE_PROMPT);
      expect(response).toContain('2');
    }, 300_000);

    // Gemini는 session/close 미지원(E1 conditional) → resetSession 시 명시적 에러
    if (cli === 'gemini') {
      it('resetSession: Gemini는 session/close 미지원으로 에러 throw', async () => {
        const { client: c } = await connectClient(cli);
        client = c;

        await expect(client.resetSession()).rejects.toThrow();
      }, 180_000);
    } else {
      it('resetSession 후 새 세션에서 응답 가능', async () => {
        const { client: c } = await connectClient(cli);
        client = c;
        const sessionIdBefore = client.getConnectionInfo().sessionId;

        const resetResult = await withTimeout(
          client.resetSession(),
          120_000,
          `${cli} resetSession`,
        );
        const sessionIdAfter = resetResult.session?.sessionId;

        // 세션 ID가 바뀌어야 함 (새 세션)
        expect(sessionIdAfter).toBeTruthy();
        expect(sessionIdAfter).not.toBe(sessionIdBefore);

        const { response } = await sendAndCollect(client, SIMPLE_PROMPT);
        expect(response).toContain('2');
      }, 300_000);
    }

    it('consumed handle로 connect() 시 에러', async () => {
      const client1 = new UnifiedAgentClient();
      client1.on('error', () => {});

      const handle = await withTimeout(
        client1.preSpawn(cli),
        60_000,
        `${cli} preSpawn`,
      );

      // 1차 connect
      await withTimeout(
        client1.connect({
          preSpawned: handle,
          cwd: process.cwd(),
          autoApprove: true,
          clientInfo: { name: 'E2E-PreSpawn', version: '1.0.0' },
        }),
        120_000,
        `${cli} connect`,
      );
      await client1.disconnect();

      // 2차 connect: consumed handle → 에러
      const client2 = new UnifiedAgentClient();
      client2.on('error', () => {});

      await expect(
        client2.connect({
          preSpawned: handle,
          cwd: process.cwd(),
          autoApprove: true,
        }),
      ).rejects.toThrow();

      await client2.disconnect();
    }, 300_000);
  });
}

// 설치된 CLI에 대해서만 테스트 실행
if (isCliInstalled('claude')) runPreSpawnTests('claude');
if (isCliInstalled('codex')) runPreSpawnTests('codex');
if (isCliInstalled('gemini')) runPreSpawnTests('gemini');
