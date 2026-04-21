/**
 * E2E: Claude ProcessPool 요청 구간 벤치마크
 * 요청 횟수별로 cold spawn 대비 pool 재사용 누적 효과를 측정합니다.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { getProcessPool, UnifiedAgentClient } from '../../src/index.js';
import { isCliInstalled, SIMPLE_PROMPT } from './helpers.js';

// ─── 타입/상수 ───────────────────────────────────────────

interface BatchSample {
  requests: number;
  coldTotalMs: number;
  pooledTotalMs: number;
  improvementPct: number;
  savedMs: number;
}

const CLI_INSTALLED = isCliInstalled('claude');
const CLAUDE_MODEL = 'haiku';
const REQUEST_COUNTS = [1, 2, 3, 5];
const SAMPLE_COUNT = Number.parseInt(process.env.CLAUDE_POOL_SAMPLE_COUNT ?? '2', 10);

// ─── 테스트 ──────────────────────────────────────────────

describe.skipIf(!CLI_INSTALLED)('E2E: Claude ProcessPool 요청 구간 벤치마크', () => {
  afterAll(async () => {
    await getProcessPool().drain();
  });

  it('요청 횟수별 누적 시간 비교', async () => {
    const results: BatchSample[] = [];

    for (const requests of REQUEST_COUNTS) {
      results.push(await benchmarkRequestCount(requests, SAMPLE_COUNT));
    }

    logSamples(results);

    expect(results).toHaveLength(REQUEST_COUNTS.length);
    for (const result of results.slice(1)) {
      expect(result.savedMs).toBeGreaterThan(0);
      expect(result.improvementPct).toBeGreaterThan(0);
    }
  }, 900_000);
});

// ─── 함수 ────────────────────────────────────────────────

async function benchmarkRequestCount(requests: number, sampleCount: number): Promise<BatchSample> {
  const coldTotals: number[] = [];
  const pooledTotals: number[] = [];

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    await getProcessPool().drain();
    coldTotals.push(await runBatch(requests, false));

    await getProcessPool().drain();
    pooledTotals.push(await runBatch(requests, true));

    await getProcessPool().drain();
  }

  const coldTotalMs = average(coldTotals);
  const pooledTotalMs = average(pooledTotals);

  return {
    requests,
    coldTotalMs,
    pooledTotalMs,
    improvementPct: improvementPct(coldTotalMs, pooledTotalMs),
    savedMs: coldTotalMs - pooledTotalMs,
  };
}

async function runBatch(requests: number, usePool: boolean): Promise<number> {
  const startedAt = performance.now();

  for (let index = 0; index < requests; index++) {
    if (!usePool) {
      await getProcessPool().drain();
    }

    await runSingleRequest();
  }

  return performance.now() - startedAt;
}

async function runSingleRequest(): Promise<void> {
  const client = new UnifiedAgentClient();
  client.on('error', () => {});

  await client.connect({
    cwd: process.cwd(),
    cli: 'claude',
    model: CLAUDE_MODEL,
    autoApprove: true,
    clientInfo: { name: 'ClaudePool-Threshold', version: '1.0.0' },
    timeout: 120_000,
  });

  await client.sendMessage(SIMPLE_PROMPT);
  await client.disconnect();
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function improvementPct(baseline: number, candidate: number): number {
  return ((baseline - candidate) / baseline) * 100;
}

function logSamples(samples: BatchSample[]): void {
  console.log('\n[Claude ProcessPool threshold]');
  console.log(JSON.stringify(samples.map((sample) => ({
    requests: sample.requests,
    coldTotalMs: round2(sample.coldTotalMs),
    pooledTotalMs: round2(sample.pooledTotalMs),
    savedMs: round2(sample.savedMs),
    improvementPct: round2(sample.improvementPct),
  }))));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
