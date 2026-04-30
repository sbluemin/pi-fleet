import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const mockAcpConnect = vi.fn();
const mockAcpDisconnect = vi.fn();
const mockAcpEndSession = vi.fn();
const mockAcpCreateSession = vi.fn();
const mockAcpLoadSession = vi.fn();
const mockAcpSendPrompt = vi.fn();
const mockAcpCancelSession = vi.fn();
const mockAcpSetModel = vi.fn();
const mockAcpSetConfigOption = vi.fn();
const mockAcpSetMode = vi.fn();
const mockAcpRemoveAllListeners = vi.fn();

function createMockAcpConnection(): EventEmitter & Record<string, unknown> {
  const emitter = new EventEmitter();
  Object.assign(emitter, {
    connect: mockAcpConnect,
    disconnect: mockAcpDisconnect,
    endSession: mockAcpEndSession,
    createSession: mockAcpCreateSession,
    loadSession: mockAcpLoadSession,
    sendPrompt: mockAcpSendPrompt,
    cancelSession: mockAcpCancelSession,
    setModel: mockAcpSetModel,
    setConfigOption: mockAcpSetConfigOption,
    setMode: mockAcpSetMode,
    removeAllListeners: mockAcpRemoveAllListeners,
    connectionState: 'ready',
    canResetSession: true,
  });
  return emitter as EventEmitter & Record<string, unknown>;
}

vi.mock('../../src/connection/CodexAppServerConnection.js', () => ({
  CodexAppServerConnection: vi.fn(),
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

const { UnifiedCodexAgentClient } = await import('../../src/client/UnifiedCodexAgentClient.js');
const { AcpConnection } = await import('../../src/connection/AcpConnection.js');

describe('UnifiedCodexAgentClient ACP 기본 경로', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcpConnect.mockResolvedValue({ sessionId: 'codex-session-1' });
    mockAcpDisconnect.mockResolvedValue(undefined);
    mockAcpEndSession.mockResolvedValue(undefined);
    mockAcpCreateSession.mockResolvedValue({ sessionId: 'codex-session-2' });
    mockAcpLoadSession.mockResolvedValue(undefined);
    mockAcpSendPrompt.mockResolvedValue({ stopReason: 'end_turn' });
    mockAcpCancelSession.mockResolvedValue(undefined);
    mockAcpSetModel.mockResolvedValue(undefined);
    mockAcpSetConfigOption.mockResolvedValue(undefined);
    mockAcpSetMode.mockResolvedValue(undefined);
  });

  it('codex 연결은 codex ACP bridge와 Codex 전용 -c override를 사용한다', async () => {
    const client = new UnifiedCodexAgentClient();

    await client.connect({
      cwd: '/workspace',
      cli: 'codex',
      systemPrompt: '개발자 지침',
      model: 'gpt-5.4',
      mcpServers: [{
        type: 'http',
        name: 'test-math',
        url: 'http://127.0.0.1:1234',
        toolTimeout: 180,
      }],
    });

    expect(AcpConnection).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.stringContaining('npx'),
      args: expect.arrayContaining([
        '--package=@zed-industries/codex-acp@0.12.0',
        'codex-acp',
        '-c',
        'approval_policy="never"',
        '-c',
        'sandbox_mode="danger-full-access"',
        '-c',
        'developer_instructions="개발자 지침"',
        '-c',
        'mcp_servers.test-math.url="http://127.0.0.1:1234"',
        '-c',
        'mcp_servers.test-math.tool_timeout_sec=180',
      ]),
      cliType: 'codex-acp-bridge',
    }));
    expect(mockAcpConnect).toHaveBeenCalledWith(
      '/workspace',
      undefined,
      [{ type: 'http', name: 'test-math', url: 'http://127.0.0.1:1234', headers: [] }],
      '개발자 지침',
    );
    expect(client.getConnectionInfo().protocol).toBe('acp');
  });

  it('configOverrides의 mcp_servers 설정도 codex ACP spawn 인자에 유지한다', async () => {
    const client = new UnifiedCodexAgentClient();

    await client.connect({
      cwd: '/workspace',
      cli: 'codex',
      configOverrides: [
        'mcp_servers.pi-tools.url="http://127.0.0.1:54300"',
        'model="gpt-5.4"',
      ],
    });

    expect(AcpConnection).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        '-c',
        'mcp_servers.pi-tools.url="http://127.0.0.1:54300"',
        '-c',
        'model="gpt-5.4"',
      ]),
    }));
  });

  it('codex session resume은 ACP connect에 sessionId와 systemPrompt를 전달한다', async () => {
    const client = new UnifiedCodexAgentClient();

    await client.connect({
      cwd: '/workspace',
      cli: 'codex',
      sessionId: 'codex-session-existing',
      systemPrompt: '재개 지침',
      model: 'gpt-5.4',
    });

    expect(mockAcpConnect).toHaveBeenCalledWith(
      '/workspace',
      'codex-session-existing',
      [],
      '재개 지침',
    );
    expect(client.getCurrentSystemPrompt()).toBe('재개 지침');
  });

  it('setModel/setConfigOption/setMode는 ACP 세션 호출로 즉시 전달한다', async () => {
    const client = new UnifiedCodexAgentClient();
    await client.connect({
      cwd: '/workspace',
      cli: 'codex',
    });

    await client.setModel('gpt-5.4-mini');
    await client.setConfigOption('reasoning_effort', 'high');
    await client.setMode('yolo');
    await client.sendMessage('안녕');

    expect(mockAcpSetModel).toHaveBeenCalledWith('codex-session-1', 'gpt-5.4-mini');
    expect(mockAcpSetConfigOption).toHaveBeenCalledWith('codex-session-1', 'reasoning_effort', 'high');
    expect(mockAcpSetMode).toHaveBeenCalledWith('codex-session-1', 'yolo');
    expect(mockAcpSendPrompt).toHaveBeenCalledWith('codex-session-1', '안녕');
  });

  it('loadSession은 ACP loadSession 경로를 사용한다', async () => {
    const client = new UnifiedCodexAgentClient();
    await client.connect({
      cwd: '/workspace',
      cli: 'codex',
    });

    await client.loadSession('loaded-session', [{
      type: 'http',
      name: 'pi-tools',
      url: 'http://127.0.0.1:54300',
    }]);

    expect(mockAcpLoadSession).toHaveBeenCalledWith({
      sessionId: 'loaded-session',
      cwd: '/workspace',
      mcpServers: [{ type: 'http', name: 'pi-tools', url: 'http://127.0.0.1:54300', headers: [] }],
    });
    expect(client.getConnectionInfo().sessionId).toBe('loaded-session');
  });

  it('resetSession은 기존 ACP 세션을 종료하고 새 세션을 만든다', async () => {
    const client = new UnifiedCodexAgentClient();
    await client.connect({
      cwd: '/workspace',
      cli: 'codex',
      yoloMode: false,
      systemPrompt: '초기 지침',
    });

    const result = await client.resetSession('/next-workspace');

    expect(mockAcpEndSession).toHaveBeenCalledWith('codex-session-1');
    expect(mockAcpCreateSession).toHaveBeenCalledWith(
      '/next-workspace',
      undefined,
      [],
      '초기 지침',
    );
    expect(result).toEqual({
      cli: 'codex',
      protocol: 'acp',
      session: { sessionId: 'codex-session-2' },
    });
    expect(client.getConnectionInfo().sessionId).toBe('codex-session-2');

    await client.sendMessage('RESET_SENTINEL');

    expect(mockAcpSendPrompt).toHaveBeenCalledWith('codex-session-2', 'RESET_SENTINEL');
    expect(mockAcpSendPrompt).not.toHaveBeenCalledWith(
      'codex-session-2',
      expect.arrayContaining([{ type: 'text', text: '초기 지침' }]),
    );
  });
});
