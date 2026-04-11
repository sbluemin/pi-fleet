/**
 * E2E: ProcessPool 벤치마크
 * 실제 CLI를 반복 연결하여 cold spawn 대비 pool 재사용 효과를 측정합니다.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { getProcessPool, UnifiedAgentClient } from '../../src/index.js';
import type { CliType } from '../../src/types/config.js';
import { isCliInstalled, SIMPLE_PROMPT } from './helpers.js';

// ─── 타입/상수 ───────────────────────────────────────────

interface BenchTarget {
  cli: CliType;
  model?: string;
}

interface BenchIteration {
  connectMs: number;
  totalMs: number;
  sessionId: string | null;
}

interface BenchSummary {
  cli: CliType;
  model?: string;
  rounds: number;
  cold: BenchIteration[];
  pooled: BenchIteration[];
  connectAvgImprovementPct: number;
  totalAvgImprovementPct: number;
}

const BENCH_ROUNDS = Number.parseInt(process.env.PROCESS_POOL_BENCH_ROUNDS ?? '3', 10);
const TARGETS: BenchTarget[] = [
  { cli: 'claude', model: 'haiku' },
  { cli: 'codex', model: 'gpt-5.3-codex-spark' },
];

// ─── 테스트 ──────────────────────────────────────────────

describe('E2E: ProcessPool 벤치마크', () => {
  afterAll(async () => {
    await getProcessPool().drain();
  });

  it('cold spawn 대비 pool 재사용 속도 비교', async () => {
    const availableTargets = TARGETS.filter((target) => isCliInstalled(target.cli));
    expect(availableTargets.length).toBeGreaterThan(0);

    const results: BenchSummary[] = [];

    for (const target of availableTargets) {
      results.push(await runBenchmark(target, BENCH_ROUNDS));
    }

    for (const summary of results) {
      logSummary(summary);
      expect(summary.pooled).toHaveLength(BENCH_ROUNDS);
      expect(summary.connectAvgImprovementPct).toBeGreaterThan(0);
      expect(summary.totalAvgImprovementPct).toBeGreaterThan(0);
    }
  }, 900_000);
});

// ─── 함수 ────────────────────────────────────────────────

async function runBenchmark(target: BenchTarget, rounds: number): Promise<BenchSummary> {
  await getProcessPool().drain();

  const cold: BenchIteration[] = [];
  for (let i = 0; i < rounds; i++) {
    await getProcessPool().drain();
    cold.push(await runSingleRound(target));
    await getProcessPool().drain();
  }

  await getProcessPool().drain();

  // 첫 연결은 warm 엔트리 생성용으로만 사용하고 집계에서 제외합니다.
  const warmup = await runSingleRound(target);
  await assertWarmupSeeded(target.cli, warmup.sessionId);

  const pooled: BenchIteration[] = [];
  for (let i = 0; i < rounds; i++) {
    pooled.push(await runSingleRound(target));
  }

  const coldConnectAvg = average(cold.map((item) => item.connectMs));
  const pooledConnectAvg = average(pooled.map((item) => item.connectMs));
  const coldTotalAvg = average(cold.map((item) => item.totalMs));
  const pooledTotalAvg = average(pooled.map((item) => item.totalMs));

  await getProcessPool().drain();

  return {
    cli: target.cli,
    model: target.model,
    rounds,
    cold,
    pooled,
    connectAvgImprovementPct: improvementPct(coldConnectAvg, pooledConnectAvg),
    totalAvgImprovementPct: improvementPct(coldTotalAvg, pooledTotalAvg),
  };
}

async function runSingleRound(target: BenchTarget): Promise<BenchIteration> {
  const client = new UnifiedAgentClient();
  client.on('error', () => {});

  const connectStart = performance.now();
  const connectResult = await client.connect({
    cwd: process.cwd(),
    cli: target.cli,
    model: target.model,
    autoApprove: true,
    clientInfo: { name: 'ProcessPool-Bench', version: '1.0.0' },
    timeout: 120_000,
  });
  const connectMs = performance.now() - connectStart;

  const totalStart = connectStart;
  await collectResponse(client, SIMPLE_PROMPT);
  await client.disconnect();
  const totalMs = performance.now() - totalStart;

  return {
    connectMs,
    totalMs,
    sessionId: connectResult.session?.sessionId ?? null,
  };
}

async function collectResponse(client: UnifiedAgentClient, prompt: string): Promise<string> {
  const chunks: string[] = [];
  const onChunk = (text: string): void => {
    chunks.push(text);
  };

  client.on('messageChunk', onChunk);
  try {
    await client.sendMessage(prompt);
  } finally {
    client.off('messageChunk', onChunk);
  }

  return chunks.join('');
}

async function assertWarmupSeeded(cli: CliType, sessionId: string | null): Promise<void> {
  expect(sessionId).toBeTruthy();
  expect(getProcessPool().size(cli)).toBeGreaterThan(0);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function improvementPct(baseline: number, candidate: number): number {
  return ((baseline - candidate) / baseline) * 100;
}

function logSummary(summary: BenchSummary): void {
  const coldConnectAvg = average(summary.cold.map((item) => item.connectMs));
  const pooledConnectAvg = average(summary.pooled.map((item) => item.connectMs));
  const coldTotalAvg = average(summary.cold.map((item) => item.totalMs));
  const pooledTotalAvg = average(summary.pooled.map((item) => item.totalMs));

  console.log('\n[ProcessPool benchmark]');
  console.log(JSON.stringify({
    cli: summary.cli,
    model: summary.model,
    rounds: summary.rounds,
    coldConnectAvgMs: round2(coldConnectAvg),
    pooledConnectAvgMs: round2(pooledConnectAvg),
    connectAvgImprovementPct: round2(summary.connectAvgImprovementPct),
    coldTotalAvgMs: round2(coldTotalAvg),
    pooledTotalAvgMs: round2(pooledTotalAvg),
    totalAvgImprovementPct: round2(summary.totalAvgImprovementPct),
    coldConnectMs: summary.cold.map((item) => round2(item.connectMs)),
    pooledConnectMs: summary.pooled.map((item) => round2(item.connectMs)),
    coldTotalMs: summary.cold.map((item) => round2(item.totalMs)),
    pooledTotalMs: summary.pooled.map((item) => round2(item.totalMs)),
  }));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
