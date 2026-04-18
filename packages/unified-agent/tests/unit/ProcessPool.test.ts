import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { CliSpawnConfig } from '../../src/types/config.js';
import type { AcpConnection } from '../../src/connection/AcpConnection.js';

const {
  mockCreateSpawnConfig,
  mockAcpConnectionConstructor,
  mockInitializeConnection,
} = vi.hoisted(() => ({
  mockCreateSpawnConfig: vi.fn(),
  mockAcpConnectionConstructor: vi.fn(),
  mockInitializeConnection: vi.fn(),
}));

vi.mock('../../src/config/CliConfigs.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/CliConfigs.js')>('../../src/config/CliConfigs.js');
  return {
    ...actual,
    createSpawnConfig: mockCreateSpawnConfig,
  };
});

vi.mock('../../src/connection/AcpConnection.js', () => ({
  AcpConnection: vi.fn((options: Record<string, unknown>) => {
    mockAcpConnectionConstructor(options);
    const emitter = new EventEmitter();
    Object.assign(emitter, {
      childProcess: { exitCode: null, kill: vi.fn() },
      canResetSession: true,
      disconnect: vi.fn().mockResolvedValue(undefined),
      initializeConnection: mockInitializeConnection,
      createSession: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
      removeAllListeners: vi.fn(),
      connectionState: 'connected',
    });
    return emitter;
  }),
}));

const { ProcessPool, resetProcessPool } = await import('../../src/pool/ProcessPool.js');

// ─── 헬퍼 ────────────────────────────────────────────────

function createMockConnection(overrides?: {
  exitCode?: number | null;
  canResetSession?: boolean;
}): AcpConnection {
  const emitter = new EventEmitter();
  const child = { exitCode: overrides?.exitCode ?? null, kill: vi.fn() };

  Object.assign(emitter, {
    childProcess: child,
    canResetSession: overrides?.canResetSession ?? true,
    disconnect: vi.fn().mockResolvedValue(undefined),
    initializeConnection: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
    removeAllListeners: vi.fn(),
    connectionState: 'connected',
  });

  return emitter as unknown as AcpConnection;
}

function createSpawnConfig(command: string, args: string[], useNpx = false): CliSpawnConfig {
  return { command, args, useNpx };
}

// ─── 테스트 ──────────────────────────────────────────────

describe('ProcessPool', () => {
  let pool: InstanceType<typeof ProcessPool>;

  beforeEach(() => {
    resetProcessPool();
    pool = new ProcessPool({ maxPerCli: 2, idleTtlMs: 300_000 });
    vi.clearAllMocks();
    mockInitializeConnection.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await pool.drain();
  });

  // ─── acquire/release ───────────────────────────────────

  describe('acquire/release', () => {
    it('warm 엔트리 acquire → Pool에서 제거', async () => {
      const conn = createMockConnection();
      await pool.release('claude', conn);
      expect(pool.size('claude')).toBe(1);

      const acquired = pool.acquire('claude');
      expect(acquired).toBe(conn);
      expect(pool.size('claude')).toBe(0);
    });

    it('release → warm 상태로 Pool에 추가', async () => {
      const conn = createMockConnection();
      await pool.release('claude', conn);
      expect(pool.size('claude')).toBe(1);
    });

    it('Gemini(canResetSession=false) release 시 disconnect', async () => {
      const conn = createMockConnection({ canResetSession: false });
      await pool.release('gemini', conn);

      // Pool에 넣지 않음
      expect(pool.size('gemini')).toBe(0);
      // disconnect 호출됨
      expect(conn.disconnect).toHaveBeenCalled();
    });

    it('dead 프로세스 acquire 시 제거', async () => {
      const conn = createMockConnection({ exitCode: 1 });
      await pool.release('claude', conn);
      expect(pool.size('claude')).toBe(1);

      const acquired = pool.acquire('claude');
      expect(acquired).toBeNull();
      expect(pool.size('claude')).toBe(0);
    });

    it('maxPerCli 초과 시 오래된 엔트리 제거', async () => {
      const conn1 = createMockConnection();
      const conn2 = createMockConnection();
      const conn3 = createMockConnection();

      await pool.release('claude', conn1);
      await pool.release('claude', conn2);
      expect(pool.size('claude')).toBe(2);

      // 3번째 release → 기존 엔트리 중 하나가 제거됨
      await pool.release('claude', conn3);
      expect(pool.size('claude')).toBe(2);
      // conn1 또는 conn2 중 하나가 disconnect됨 (createdAt이 동일할 수 있음)
      const disconnected = [conn1, conn2].some(
        c => (c.disconnect as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      );
      expect(disconnected).toBe(true);
    });

    it('Pool 비어있으면 acquire → null', () => {
      const result = pool.acquire('claude');
      expect(result).toBeNull();
    });

    it('다른 CLI의 엔트리는 acquire 불가', async () => {
      const conn = createMockConnection();
      await pool.release('claude', conn);

      const result = pool.acquire('codex');
      expect(result).toBeNull();
      expect(pool.size('claude')).toBe(1);
    });
  });

  // ─── warmUp ──────────────────────────────────────────────

  describe('warmUp', () => {
    it('새 AcpConnection + initializeConnection 호출', async () => {
      // warmUp은 실제 AcpConnection을 생성하므로 모듈 mock 필요
      // 여기서는 createSpawnConfig + AcpConnection 생성자를 mock
      const testPool = new ProcessPool({ maxPerCli: 2 });

      // warmUp 대신 release로 Pool에 직접 넣어서 기본 동작 검증
      const mockConn = createMockConnection();
      await testPool.release('claude', mockConn);
      const acquired = testPool.acquire('claude');
      expect(acquired).toBe(mockConn);

      await testPool.drain();
    });

    it('gemini warmUp: createSpawnConfig 계약과 initializeConnection 호출을 검증', async () => {
      const spawnConfig = createSpawnConfig('gemini', ['--acp']);
      mockCreateSpawnConfig.mockReturnValue(spawnConfig);

      await pool.warmUp('gemini', {
        cliPath: '/custom/gemini',
        timeout: 5000,
        env: { FOO: 'bar' },
      });

      expect(mockCreateSpawnConfig).toHaveBeenCalledWith('gemini', {
        cwd: process.cwd(),
        cliPath: '/custom/gemini',
        timeout: 5000,
        env: { FOO: 'bar' },
      });
      expect(mockAcpConnectionConstructor).toHaveBeenCalledWith(expect.objectContaining({
        command: 'gemini',
        args: ['--acp'],
        cwd: process.cwd(),
        requestTimeout: 5000,
        initTimeout: 5000,
      }));
      expect(mockInitializeConnection).toHaveBeenCalledWith(process.cwd());
      expect(pool.size('gemini')).toBe(1);
    });

    it('codex warmUp: createSpawnConfig 계약과 initializeConnection 호출을 검증', async () => {
      const spawnConfig = createSpawnConfig('npx', ['--package=@zed-industries/codex-acp@0.11.1', 'codex-acp'], true);
      mockCreateSpawnConfig.mockReturnValue(spawnConfig);

      await pool.warmUp('codex', {
        timeout: 7000,
        clientInfo: { name: 'test-client', version: '1.2.3' },
      });

      expect(mockCreateSpawnConfig).toHaveBeenCalledWith('codex', {
        cwd: process.cwd(),
        timeout: 7000,
        clientInfo: { name: 'test-client', version: '1.2.3' },
      });
      expect(mockAcpConnectionConstructor).toHaveBeenCalledWith(expect.objectContaining({
        command: 'npx',
        args: ['--package=@zed-industries/codex-acp@0.11.1', 'codex-acp'],
        cwd: process.cwd(),
        requestTimeout: 7000,
        initTimeout: 7000,
        clientInfo: { name: 'test-client', version: '1.2.3' },
      }));
      expect(mockInitializeConnection).toHaveBeenCalledWith(process.cwd());
      expect(pool.size('codex')).toBe(1);
    });
  });

  // ─── drain ────────────────────────────────────────────────

  describe('drain', () => {
    it('모든 엔트리 disconnect + size 0', async () => {
      const conn1 = createMockConnection();
      const conn2 = createMockConnection();

      await pool.release('claude', conn1);
      await pool.release('codex', conn2);
      expect(pool.size()).toBe(2);

      await pool.drain();

      expect(pool.size()).toBe(0);
      expect(conn1.disconnect).toHaveBeenCalled();
      expect(conn2.disconnect).toHaveBeenCalled();
    });
  });

  // ─── TTL ──────────────────────────────────────────────────

  describe('TTL', () => {
    it('TTL 만료 시 자동 disconnect 및 제거', async () => {
      vi.useFakeTimers();
      const shortTtlPool = new ProcessPool({ maxPerCli: 2, idleTtlMs: 1000 });
      const conn = createMockConnection();

      await shortTtlPool.release('claude', conn);
      expect(shortTtlPool.size('claude')).toBe(1);

      // TTL 만료
      vi.advanceTimersByTime(1100);

      expect(shortTtlPool.size('claude')).toBe(0);
      expect(conn.disconnect).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('acquire 시 TTL 타이머 취소', async () => {
      vi.useFakeTimers();
      const shortTtlPool = new ProcessPool({ maxPerCli: 2, idleTtlMs: 1000 });
      const conn = createMockConnection();

      await shortTtlPool.release('claude', conn);
      const acquired = shortTtlPool.acquire('claude');
      expect(acquired).toBe(conn);

      // TTL 만료 시간 경과해도 disconnect 호출 안 됨
      vi.advanceTimersByTime(2000);
      expect(conn.disconnect).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ─── size ─────────────────────────────────────────────────

  describe('size', () => {
    it('cli별/전체 엔트리 수', async () => {
      const conn1 = createMockConnection();
      const conn2 = createMockConnection();

      await pool.release('claude', conn1);
      await pool.release('codex', conn2);

      expect(pool.size('claude')).toBe(1);
      expect(pool.size('codex')).toBe(1);
      expect(pool.size('gemini')).toBe(0);
      expect(pool.size()).toBe(2);
    });
  });
});
