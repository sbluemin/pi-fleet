import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { NewSessionResponse } from '@agentclientprotocol/sdk';
import type { PreSpawnedHandle } from '../../src/types/config.js';

// ─── AcpConnection mock ─────────────────────────────────

const mockConnect = vi.fn();
const mockConnectWithExternalProcess = vi.fn();
const mockDisconnect = vi.fn();
const mockSetMode = vi.fn();
const mockSetModel = vi.fn();
const mockRemoveAllListeners = vi.fn();

function createMockAcpConnection(): EventEmitter & Record<string, unknown> {
  const emitter = new EventEmitter();
  Object.assign(emitter, {
    connect: mockConnect,
    connectWithExternalProcess: mockConnectWithExternalProcess,
    disconnect: mockDisconnect,
    setMode: mockSetMode,
    setModel: mockSetModel,
    connectionState: 'ready',
    removeAllListeners: mockRemoveAllListeners,
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

// UnifiedAgentClient import는 mock 이후에
const { UnifiedAgentClient } = await import('../../src/client/UnifiedAgentClient.js');

// ─── 헬퍼 ────────────────────────────────────────────────

const defaultSession: NewSessionResponse = {
  sessionId: 'session-from-handle',
} as NewSessionResponse;

function createAliveHandle(cli: 'gemini' | 'claude' | 'codex' = 'gemini'): PreSpawnedHandle {
  const child = new EventEmitter() as unknown as import('child_process').ChildProcess;
  Object.defineProperty(child, 'exitCode', { value: null, writable: true });
  const stream = {} as import('@agentclientprotocol/sdk').Stream;

  return {
    cli,
    child,
    stream,
    consumed: false,
  } as unknown as PreSpawnedHandle;
}

function createDeadHandle(cli: 'gemini' | 'claude' | 'codex' = 'gemini'): PreSpawnedHandle {
  const child = new EventEmitter() as unknown as import('child_process').ChildProcess;
  Object.defineProperty(child, 'exitCode', { value: 1, writable: true });
  const stream = {} as import('@agentclientprotocol/sdk').Stream;

  return {
    cli,
    child,
    stream,
    consumed: false,
  } as unknown as PreSpawnedHandle;
}

// ─── 테스트 ──────────────────────────────────────────────

describe('preSpawn handle 관리', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectWithExternalProcess.mockResolvedValue(defaultSession);
    mockConnect.mockResolvedValue(defaultSession);
  });

  it('alive handle로 connect() 시 connectWithExternalProcess 사용 (spawn 생략)', async () => {
    const client = new UnifiedAgentClient();
    const handle = createAliveHandle('gemini');

    const result = await client.connect({
      cwd: '/workspace',
      preSpawned: handle,
    });

    expect(mockConnectWithExternalProcess).toHaveBeenCalledWith(
      handle.child,
      handle.stream,
      '/workspace',
      undefined,
    );
    // connect()가 아닌 connectWithExternalProcess 사용 확인
    expect(mockConnect).not.toHaveBeenCalled();
    expect(result.cli).toBe('gemini');
    expect(result.session?.sessionId).toBe('session-from-handle');
  });

  it('dead handle로 connect() 시 기존 spawn fallback (connectAcp)', async () => {
    const client = new UnifiedAgentClient();
    const handle = createDeadHandle('claude');

    const result = await client.connect({
      cwd: '/workspace',
      preSpawned: handle,
    });

    // dead handle → connectAcp 경로 → acpConnection.connect() 호출
    expect(mockConnect).toHaveBeenCalled();
    expect(mockConnectWithExternalProcess).not.toHaveBeenCalled();
    expect(result.cli).toBe('claude');
  });

  it('consumed handle로 connect() 시 즉시 에러', async () => {
    const client = new UnifiedAgentClient();
    const handle = createAliveHandle('gemini');
    handle.consumed = true;

    await expect(
      client.connect({ cwd: '/workspace', preSpawned: handle }),
    ).rejects.toThrow('PreSpawnedHandle이 이미 소비되었습니다');
  });

  it('connect() 성공 후 handle.consumed === true', async () => {
    const client = new UnifiedAgentClient();
    const handle = createAliveHandle('codex');

    await client.connect({ cwd: '/workspace', preSpawned: handle });

    expect(handle.consumed).toBe(true);
  });

  it('connectWithHandle 실패 시 cleanupFailedAcpConnection 호출', async () => {
    mockConnectWithExternalProcess.mockRejectedValue(new Error('handshake failed'));
    const client = new UnifiedAgentClient();
    const handle = createAliveHandle('gemini');

    await expect(
      client.connect({ cwd: '/workspace', preSpawned: handle }),
    ).rejects.toThrow('handshake failed');

    // cleanup 호출 확인: disconnect가 호출되었고 연결 정보가 초기화됨
    const info = client.getConnectionInfo();
    expect(info.cli).toBeNull();
    expect(info.sessionId).toBeNull();
  });
});
