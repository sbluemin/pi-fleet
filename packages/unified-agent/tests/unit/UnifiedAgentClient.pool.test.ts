import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { NewSessionResponse } from '@agentclientprotocol/sdk';

// ─── ProcessPool mock ───────────────────────────────────

const mockAcquire = vi.fn();
const mockRelease = vi.fn();
const mockWarmUp = vi.fn();
const mockDrain = vi.fn();

vi.mock('../../src/pool/ProcessPool.js', () => ({
  getProcessPool: vi.fn(() => ({
    acquire: mockAcquire,
    release: mockRelease,
    warmUp: mockWarmUp,
    drain: mockDrain,
    size: vi.fn().mockReturnValue(0),
  })),
  ProcessPool: vi.fn(),
  resetProcessPool: vi.fn(),
}));

// ─── AcpConnection mock ─────────────────────────────────

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockEndSession = vi.fn();
const mockReconnectSession = vi.fn();
const mockSetMode = vi.fn();
const mockSetModel = vi.fn();
const mockRemoveAllListeners = vi.fn();
const mockCreateSession = vi.fn();

function createMockAcpConnection(overrides?: Record<string, unknown>): EventEmitter & Record<string, unknown> {
  const emitter = new EventEmitter();
  Object.assign(emitter, {
    connect: mockConnect,
    disconnect: mockDisconnect,
    endSession: mockEndSession,
    reconnectSession: mockReconnectSession,
    createSession: mockCreateSession,
    setMode: mockSetMode,
    setModel: mockSetModel,
    connectionState: 'ready',
    removeAllListeners: mockRemoveAllListeners,
    canResetSession: true,
    childProcess: { exitCode: null, kill: vi.fn() },
    ...overrides,
  });
  return emitter as EventEmitter & Record<string, unknown>;
}

vi.mock('../../src/connection/AcpConnection.js', () => ({
  AcpConnection: vi.fn(() => createMockAcpConnection()),
}));

vi.mock('../../src/detector/CliDetector.js', () => ({
  CliDetector: vi.fn(() => ({
    detectAll: vi.fn().mockResolvedValue([]),
    getPreferred: vi.fn().mockResolvedValue(null),
  })),
}));

const { UnifiedAgentClient } = await import('../../src/client/UnifiedAgentClient.js');

// ─── 헬퍼 ────────────────────────────────────────────────

const defaultSession: NewSessionResponse = {
  sessionId: 'test-session',
} as NewSessionResponse;

// ─── 테스트 ──────────────────────────────────────────────

describe('Pool 통합', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(defaultSession);
    mockCreateSession.mockResolvedValue(defaultSession);
    mockAcquire.mockReturnValue(null);
    mockRelease.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockEndSession.mockResolvedValue(undefined);
  });

  it('connectAcp: Pool에 idle 엔트리 있으면 재사용', async () => {
    const pooledConn = createMockAcpConnection();
    mockAcquire.mockReturnValue(pooledConn);

    const client = new UnifiedAgentClient();
    const result = await client.connect({ cwd: '/workspace', cli: 'claude' });

    expect(mockAcquire).toHaveBeenCalledWith('claude');
    // pooled connection의 createSession이 호출됨
    expect(pooledConn.createSession).toHaveBeenCalledWith('/workspace', undefined, [], undefined);
    // 새 AcpConnection.connect()는 호출 안 됨
    expect(mockConnect).not.toHaveBeenCalled();
    expect(result.cli).toBe('claude');
    expect(result.session?.sessionId).toBe('test-session');
  });

  it('connectAcp: Pool 비어있으면 새 spawn', async () => {
    mockAcquire.mockReturnValue(null);

    const client = new UnifiedAgentClient();
    const result = await client.connect({ cwd: '/workspace', cli: 'claude' });

    expect(mockAcquire).toHaveBeenCalledWith('claude');
    // 새 spawn → connect() 호출
    expect(mockConnect).toHaveBeenCalled();
    expect(result.cli).toBe('claude');
  });

  it('disconnect: Claude/Codex → endSession + pool.release', async () => {
    // 먼저 연결
    const client = new UnifiedAgentClient();
    await client.connect({ cwd: '/workspace', cli: 'claude' });
    vi.clearAllMocks();
    mockEndSession.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);

    await client.disconnect();

    expect(mockEndSession).toHaveBeenCalledWith('test-session');
    expect(mockRelease).toHaveBeenCalledWith('claude', expect.anything());
  });

  it('disconnect: Gemini → pool.release에서 disconnect', async () => {
    // canResetSession=false인 connection mock
    const { AcpConnection } = await import('../../src/connection/AcpConnection.js');
    vi.mocked(AcpConnection).mockImplementation(() =>
      createMockAcpConnection({ canResetSession: false }) as unknown as InstanceType<typeof AcpConnection>,
    );

    const client = new UnifiedAgentClient();
    await client.connect({ cwd: '/workspace', cli: 'gemini' });
    vi.clearAllMocks();
    mockRelease.mockResolvedValue(undefined);

    await client.disconnect();

    // canResetSession=false → endSession 미호출, release에 위임
    expect(mockEndSession).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith('gemini', expect.anything());
  });

  it('codex + user overrides 있음: pool 우회 후 direct spawn, disconnect도 direct disconnect', async () => {
    const pooledConn = createMockAcpConnection();
    mockAcquire.mockReturnValue(pooledConn);

    const client = new UnifiedAgentClient();
    const result = await client.connect({
      cwd: '/workspace',
      cli: 'codex',
      configOverrides: ['mcp_servers.pi-tools.tool_timeout_sec=1800'],
    });

    expect(mockAcquire).not.toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledWith('/workspace', undefined, [], undefined);
    expect(pooledConn.createSession).not.toHaveBeenCalled();
    expect(result.cli).toBe('codex');

    vi.clearAllMocks();
    mockDisconnect.mockResolvedValue(undefined);

    await client.disconnect();

    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockEndSession).not.toHaveBeenCalled();
  });

  it('codex + overrides 없음: 기존처럼 pooled createSession + pool.release 유지', async () => {
    const pooledConn = createMockAcpConnection();
    mockAcquire.mockReturnValue(pooledConn);

    const client = new UnifiedAgentClient();
    const result = await client.connect({ cwd: '/workspace', cli: 'codex' });

    expect(mockAcquire).toHaveBeenCalledWith('codex');
    expect(pooledConn.createSession).toHaveBeenCalledWith('/workspace', undefined, [], undefined);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(result.cli).toBe('codex');

    vi.clearAllMocks();
    mockEndSession.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);

    await client.disconnect();

    expect(mockEndSession).toHaveBeenCalledWith('test-session');
    expect(mockRelease).toHaveBeenCalledWith('codex', expect.anything());
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
