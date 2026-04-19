import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockConnect = vi.fn();
const mockCreateSession = vi.fn();

function createMockAcpConnection(): EventEmitter & Record<string, unknown> {
  const emitter = new EventEmitter();
  Object.assign(emitter, {
    connect: mockConnect,
    createSession: mockCreateSession,
    disconnect: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    connectionState: 'ready',
    removeAllListeners: vi.fn(),
    canResetSession: true,
    childProcess: { exitCode: null, kill: vi.fn() },
  });
  return emitter as EventEmitter & Record<string, unknown>;
}

vi.mock('../../src/pool/ProcessPool.js', () => ({
  getProcessPool: vi.fn(() => ({
    acquire: vi.fn(() => null),
    release: vi.fn(async () => {}),
    warmUp: vi.fn(),
    drain: vi.fn(),
    size: vi.fn().mockReturnValue(0),
  })),
}));

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

describe('UnifiedAgentClient logEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ sessionId: 'session-1' });
    mockCreateSession.mockResolvedValue({ sessionId: 'session-1' });
  });

  it('AcpConnection의 구조화 logEntry를 그대로 forward한다', async () => {
    const client = new UnifiedAgentClient();
    const handler = vi.fn();

    client.on('logEntry', handler);
    await client.connect({ cwd: '/workspace', cli: 'claude' });

    const acpConnection = (client as unknown as { acpConnection: EventEmitter }).acpConnection;
    acpConnection.emit('logEntry', {
      message: 'bridge closed',
      source: 'stderr',
      timestamp: new Date().toISOString(),
      cli: 'claude',
      sessionId: 'session-1',
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      message: 'bridge closed',
      source: 'stderr',
      cli: 'claude',
      sessionId: 'session-1',
    }));
  });
});
