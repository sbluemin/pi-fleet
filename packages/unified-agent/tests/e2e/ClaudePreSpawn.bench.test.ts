/**
 * E2E: Claude preSpawn 벤치마크
 * cold / pool / preSpawn를 비교하고 preSpawn 준비 비용과 준비 후 첫 요청 시간을 분리합니다.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { getProcessPool, UnifiedAgentClient } from '../../src/index.js';

// ─── 타입/상수 ───────────────────────────────────────────

interface ScenarioSample {
  coldMs: number;
  pooledMs: number;
  preSpawnPrepareMs: number;
  preSpawnReadyRequestMs: number;
  preSpawnEndToEndMs: number;
}

const CLAUDE_MODEL = 'haiku';
const PROMPT = '코드 실행이나 도구 사용 없이 바로 답해줘. 1+1의 결과를 숫자만 답해. 다른 설명은 하지 마.';
const SAMPLE_COUNT = Number.parseInt(process.env.CLAUDE_PRESPAWN_SAMPLE_COUNT ?? '3', 10);

// ─── 테스트 ──────────────────────────────────────────────

describe('E2E: Claude preSpawn 벤치마크', () => {
  afterAll(async () => {
    await getProcessPool().drain();
  });

  it('cold vs pool vs preSpawn 비교', async () => {
    const samples: ScenarioSample[] = [];

    for (let index = 0; index < SAMPLE_COUNT; index++) {
      samples.push(await runScenarioSample());
    }

    const summary = summarize(samples);
    logSummary(summary, samples);

    expect(summary.pooledImprovementPct).toBeGreaterThan(0);
    expect(summary.preSpawnReadyImprovementPct).toBeGreaterThan(0);
  }, 900_000);
});

// ─── 함수 ────────────────────────────────────────────────

async function runScenarioSample(): Promise<ScenarioSample> {
  await getProcessPool().drain();
  const coldMs = await measureColdRequest();

  await getProcessPool().drain();
  await seedPool();
  const pooledMs = await measurePooledRequest();

  await getProcessPool().drain();
  const preSpawnMeasured = await measurePreSpawnRequest();

  await getProcessPool().drain();

  return {
    coldMs,
    pooledMs,
    preSpawnPrepareMs: preSpawnMeasured.prepareMs,
    preSpawnReadyRequestMs: preSpawnMeasured.readyRequestMs,
    preSpawnEndToEndMs: preSpawnMeasured.prepareMs + preSpawnMeasured.readyRequestMs,
  };
}

async function measureColdRequest(): Promise<number> {
  const client = new UnifiedAgentClient();
  client.on('error', () => {});

  const startedAt = performance.now();
  await client.connect(baseOptions());
  await client.sendMessage(PROMPT);
  await client.disconnect();
  return performance.now() - startedAt;
}

async function seedPool(): Promise<void> {
  const client = new UnifiedAgentClient();
  client.on('error', () => {});

  await client.connect(baseOptions());
  await client.sendMessage(PROMPT);
  await client.disconnect();

  expect(getProcessPool().size('claude')).toBeGreaterThan(0);
}

async function measurePooledRequest(): Promise<number> {
  const client = new UnifiedAgentClient();
  client.on('error', () => {});

  const startedAt = performance.now();
  await client.connect(baseOptions());
  await client.sendMessage(PROMPT);
  await client.disconnect();
  return performance.now() - startedAt;
}

async function measurePreSpawnRequest(): Promise<{ prepareMs: number; readyRequestMs: number }> {
  const spawner = new UnifiedAgentClient();
  spawner.on('error', () => {});

  const prepareStartedAt = performance.now();
  const handle = await spawner.preSpawn('claude', {
    timeout: 120_000,
    clientInfo: { name: 'ClaudePreSpawn-Bench', version: '1.0.0' },
  });
  const prepareMs = performance.now() - prepareStartedAt;

  const consumer = new UnifiedAgentClient();
  consumer.on('error', () => {});

  const requestStartedAt = performance.now();
  await consumer.connect({
    ...baseOptions(),
    preSpawned: handle,
  });
  await consumer.sendMessage(PROMPT);
  await consumer.disconnect();
  const readyRequestMs = performance.now() - requestStartedAt;

  return { prepareMs, readyRequestMs };
}

function baseOptions(): {
  cwd: string;
  cli: 'claude';
  model: string;
  autoApprove: true;
  timeout: number;
  clientInfo: { name: string; version: string };
} {
  return {
    cwd: process.cwd(),
    cli: 'claude',
    model: CLAUDE_MODEL,
    autoApprove: true,
    timeout: 120_000,
    clientInfo: { name: 'ClaudePreSpawn-Bench', version: '1.0.0' },
  };
}

function summarize(samples: ScenarioSample[]): {
  coldAvgMs: number;
  pooledAvgMs: number;
  preSpawnPrepareAvgMs: number;
  preSpawnReadyRequestAvgMs: number;
  preSpawnEndToEndAvgMs: number;
  pooledImprovementPct: number;
  preSpawnReadyImprovementPct: number;
  preSpawnEndToEndImprovementPct: number;
} {
  const coldAvgMs = average(samples.map((sample) => sample.coldMs));
  const pooledAvgMs = average(samples.map((sample) => sample.pooledMs));
  const preSpawnPrepareAvgMs = average(samples.map((sample) => sample.preSpawnPrepareMs));
  const preSpawnReadyRequestAvgMs = average(samples.map((sample) => sample.preSpawnReadyRequestMs));
  const preSpawnEndToEndAvgMs = average(samples.map((sample) => sample.preSpawnEndToEndMs));

  return {
    coldAvgMs,
    pooledAvgMs,
    preSpawnPrepareAvgMs,
    preSpawnReadyRequestAvgMs,
    preSpawnEndToEndAvgMs,
    pooledImprovementPct: improvementPct(coldAvgMs, pooledAvgMs),
    preSpawnReadyImprovementPct: improvementPct(coldAvgMs, preSpawnReadyRequestAvgMs),
    preSpawnEndToEndImprovementPct: improvementPct(coldAvgMs, preSpawnEndToEndAvgMs),
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function improvementPct(baseline: number, candidate: number): number {
  return ((baseline - candidate) / baseline) * 100;
}

function logSummary(
  summary: ReturnType<typeof summarize>,
  samples: ScenarioSample[],
): void {
  console.log('\n[Claude preSpawn benchmark]');
  console.log(JSON.stringify({
    sampleCount: samples.length,
    coldAvgMs: round2(summary.coldAvgMs),
    pooledAvgMs: round2(summary.pooledAvgMs),
    pooledImprovementPct: round2(summary.pooledImprovementPct),
    preSpawnPrepareAvgMs: round2(summary.preSpawnPrepareAvgMs),
    preSpawnReadyRequestAvgMs: round2(summary.preSpawnReadyRequestAvgMs),
    preSpawnReadyImprovementPct: round2(summary.preSpawnReadyImprovementPct),
    preSpawnEndToEndAvgMs: round2(summary.preSpawnEndToEndAvgMs),
    preSpawnEndToEndImprovementPct: round2(summary.preSpawnEndToEndImprovementPct),
    samples: samples.map((sample) => ({
      coldMs: round2(sample.coldMs),
      pooledMs: round2(sample.pooledMs),
      preSpawnPrepareMs: round2(sample.preSpawnPrepareMs),
      preSpawnReadyRequestMs: round2(sample.preSpawnReadyRequestMs),
      preSpawnEndToEndMs: round2(sample.preSpawnEndToEndMs),
    })),
  }));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
