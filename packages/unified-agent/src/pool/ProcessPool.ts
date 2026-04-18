/**
 * ProcessPool - AcpConnection 프로세스 풀
 * spawn+initialize 완료된 AcpConnection을 재사용하여 연결 시간을 단축합니다.
 */

import type { CliType, ConnectionOptions } from '../types/config.js';
import { AcpConnection } from '../connection/AcpConnection.js';
import { createSpawnConfig } from '../config/CliConfigs.js';
import { cleanEnvironment, isWindows } from '../utils/env.js';

// ─── 타입/인터페이스 ──────────────────────────────────────

interface PoolEntry {
  cli: CliType;
  connection: AcpConnection;
  state: 'warm' | 'releasing';
  createdAt: number;
  lastUsedAt: number;
  ttlTimer?: ReturnType<typeof setTimeout>;
}

export interface ProcessPoolOptions {
  /** CLI당 최대 엔트리 (기본: 2) */
  maxPerCli?: number;
  /** idle TTL 밀리초 (기본: 300_000 = 5분) */
  idleTtlMs?: number;
}

/** warmUp에 전달할 옵션 — 세션 관련 필드 제외 */
export type WarmUpOptions = Pick<ConnectionOptions, 'env' | 'cliPath' | 'timeout' | 'clientInfo'> & {
  autoApprove?: boolean;
};

// ─── ProcessPool 클래스 ──────────────────────────────────

export class ProcessPool {
  private readonly entries: PoolEntry[] = [];
  private readonly maxPerCli: number;
  private readonly idleTtlMs: number;

  constructor(options?: ProcessPoolOptions) {
    this.maxPerCli = options?.maxPerCli ?? 2;
    this.idleTtlMs = options?.idleTtlMs ?? 300_000;
  }

  /**
   * Pool에서 해당 CLI의 warm 엔트리를 꺼냅니다.
   * dead 프로세스는 즉시 제거하고 다음 엔트리를 탐색합니다.
   *
   * @returns AcpConnection 또는 null (없으면)
   */
  acquire(cli: CliType): AcpConnection | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.cli !== cli || entry.state !== 'warm') continue;

      // dead 프로세스 체크
      if (entry.connection.childProcess?.exitCode !== null) {
        this.removeEntry(i);
        continue;
      }

      // 살아있는 엔트리 발견 → Pool에서 제거하고 반환
      this.clearTtlTimer(entry);
      this.entries.splice(i, 1);
      return entry.connection;
    }

    return null;
  }

  /**
   * 사용 완료된 AcpConnection을 Pool에 반환합니다.
   * canResetSession=false(Gemini)인 경우 disconnect 후 반환하지 않습니다.
   */
  async release(cli: CliType, connection: AcpConnection): Promise<void> {
    if (!connection.canResetSession) {
      await connection.disconnect();
      return;
    }

    // maxPerCli 초과 시 가장 오래된 엔트리 제거
    const cliEntries = this.entries.filter(e => e.cli === cli);
    if (cliEntries.length >= this.maxPerCli) {
      const oldest = cliEntries.reduce((a, b) => a.createdAt < b.createdAt ? a : b);
      const idx = this.entries.indexOf(oldest);
      if (idx !== -1) {
        this.removeEntry(idx);
      }
    }

    const now = Date.now();
    const entry: PoolEntry = {
      cli,
      connection,
      state: 'warm',
      createdAt: now,
      lastUsedAt: now,
    };

    this.registerTtlTimer(entry);
    this.entries.push(entry);
  }

  /**
   * 새 AcpConnection을 생성하고 initializeConnection까지 수행하여 Pool에 추가합니다.
   *
   * @returns initialized된 AcpConnection
   */
  async warmUp(cli: CliType, options?: WarmUpOptions): Promise<AcpConnection> {
    const spawnConfig = createSpawnConfig(cli, { cwd: process.cwd(), ...options });
    const cleanEnv = cleanEnvironment(process.env, options?.env);
    const env: Record<string, string | undefined> = { ...cleanEnv };

    if (cli === 'gemini' && isWindows() && env.GEMINI_CLI_NO_RELAUNCH === undefined) {
      env.GEMINI_CLI_NO_RELAUNCH = 'true';
    }

    const connection = new AcpConnection({
      command: spawnConfig.command,
      args: spawnConfig.args,
      cwd: process.cwd(),
      env,
      requestTimeout: options?.timeout,
      initTimeout: options?.timeout,
      clientInfo: options?.clientInfo,
      autoApprove: options?.autoApprove,
    });

    await connection.initializeConnection(process.cwd());

    const now = Date.now();
    const entry: PoolEntry = {
      cli,
      connection,
      state: 'warm',
      createdAt: now,
      lastUsedAt: now,
    };

    this.registerTtlTimer(entry);
    this.entries.push(entry);

    return connection;
  }

  /**
   * 모든 엔트리를 disconnect하고 Pool을 비웁니다.
   */
  async drain(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const entry of this.entries) {
      this.clearTtlTimer(entry);
      promises.push(
        entry.connection.disconnect().catch(() => {}),
      );
    }
    this.entries.length = 0;
    await Promise.all(promises);
  }

  /**
   * Pool 엔트리 수를 반환합니다.
   *
   * @param cli - 특정 CLI만 필터링 (생략 시 전체)
   */
  size(cli?: CliType): number {
    if (cli) {
      return this.entries.filter(e => e.cli === cli).length;
    }
    return this.entries.length;
  }

  // ─── TTL 관리 ────────────────────────────────────────────

  private registerTtlTimer(entry: PoolEntry): void {
    if (this.idleTtlMs <= 0) return;

    entry.ttlTimer = setTimeout(() => {
      const idx = this.entries.indexOf(entry);
      if (idx !== -1) {
        this.removeEntry(idx);
      }
    }, this.idleTtlMs);

    // unref하여 타이머가 프로세스 종료를 차단하지 않도록 함
    if (entry.ttlTimer && typeof entry.ttlTimer === 'object' && 'unref' in entry.ttlTimer) {
      entry.ttlTimer.unref();
    }
  }

  private clearTtlTimer(entry: PoolEntry): void {
    if (entry.ttlTimer != null) {
      clearTimeout(entry.ttlTimer);
      entry.ttlTimer = undefined;
    }
  }

  /**
   * 엔트리를 인덱스로 제거하고 disconnect를 호출합니다.
   */
  private removeEntry(index: number): void {
    const entry = this.entries[index];
    this.clearTtlTimer(entry);
    this.entries.splice(index, 1);
    entry.connection.disconnect().catch(() => {});
  }
}

// ─── singleton ──────────────────────────────────────────

let defaultPool: ProcessPool | null = null;

export function getProcessPool(options?: ProcessPoolOptions): ProcessPool {
  if (!defaultPool) {
    defaultPool = new ProcessPool(options);
  }
  return defaultPool;
}

/** 테스트용: singleton 초기화 */
export function resetProcessPool(): void {
  defaultPool = null;
}

// ─── process.exit 시 정리 ───────────────────────────────

process.on('exit', () => {
  if (!defaultPool) return;
  // drain()은 async이므로 exit에서는 동기적으로 kill만 수행
  const pool = defaultPool as unknown as { entries: PoolEntry[] };
  for (const entry of pool.entries) {
    try {
      entry.connection.childProcess?.kill();
    } catch {
      // best-effort
    }
  }
});
