import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'child_process';

import { CodexAppServerConnection } from '../../src/connection/CodexAppServerConnection.js';

class MockStream extends EventEmitter {
  write = vi.fn((_chunk: string) => true);
}

class MockChildProcess extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();
  stdin = new MockStream();
  pid = 1234;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.killed = true;
    this.signalCode = typeof signal === 'string' ? signal : null;
    this.emit('exit', this.exitCode, this.signalCode);
    return true;
  });
}

class TestCodexAppServerConnection extends CodexAppServerConnection {
  constructor(
    private readonly mockChild: MockChildProcess,
    options?: { mcpServerNames?: string[]; mcpStartupTimeout?: number },
  ) {
    super({
      command: 'codex',
      args: ['app-server', '--listen', 'stdio://'],
      cwd: process.cwd(),
      mcpServerNames: options?.mcpServerNames,
      mcpStartupTimeout: options?.mcpStartupTimeout,
    });
  }

  protected spawnRawProcess(): ChildProcess {
    this.setState('connecting');
    this.child = this.mockChild as unknown as ChildProcess;
    this.childExitPromise = Promise.resolve();
    this.mockChild.stderr.on('data', (data: Buffer | string) => {
      this.consumeStderrChunk(data.toString());
    });
    this.mockChild.on('exit', (code, signal) => {
      this.flushStderrBuffer();
      this.setState('closed');
      this.emit('exit', code, signal);
    });
    this.mockChild.on('error', (error) => {
      this.flushStderrBuffer();
      this.setState('error');
      this.emit('error', error);
    });
    return this.mockChild as unknown as ChildProcess;
  }
}

describe('CodexAppServerConnection lifecycle', () => {
  let child: MockChildProcess;
  let connection: TestCodexAppServerConnection;

  beforeEach(() => {
    child = new MockChildProcess();
    connection = new TestCodexAppServerConnection(child);
  });

  it('initialize → thread/start → turn/completed까지 연결 lifecycle을 처리한다', async () => {
    const promptComplete = vi.fn();
    connection.on('promptComplete', promptComplete);

    const connectPromise = connection.connect({
      developerInstructions: '테스트 지침',
      model: 'gpt-5.4',
    });

    expect(readOutgoingMethods(child)).toEqual(['initialize']);

    child.stdout.emit(
      'data',
      `${jsonRpcResult(1, {
        userAgent: 'codex/test',
        codexHome: '/tmp/codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      })}\n`,
    );

    await flushMicrotask();
    expect(readOutgoingMethods(child)).toEqual(['initialize', 'thread/start']);

    child.stdout.emit(
      'data',
      `${jsonRpcResult(2, { thread: { id: 'thread-1' } })}\n`,
    );

    await expect(connectPromise).resolves.toEqual({
      thread: { id: 'thread-1' },
    });
    expect(connection.connectionState).toBe('ready');
    expect(connection.sessionId).toBe('thread-1');

    const sendPromise = connection.sendMessage([
      {
        type: 'text',
        text: '안녕하세요',
        text_elements: [],
      },
    ]);

    await flushMicrotask();
    expect(readOutgoingMethods(child)).toEqual([
      'initialize',
      'thread/start',
      'turn/start',
    ]);

    child.stdout.emit(
      'data',
      `${jsonRpcResult(3, { turn: { id: 'turn-1' } })}\n`,
    );
    child.stdout.emit(
      'data',
      `${jsonRpcNotification('turn/started', {
        threadId: 'thread-1',
        turn: { id: 'turn-1' },
      })}\n`,
    );
    child.stdout.emit(
      'data',
      `${jsonRpcNotification('turn/completed', {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'completed',
          error: null,
        },
      })}\n`,
    );

    await sendPromise;
    expect(promptComplete).toHaveBeenCalledWith('thread-1');
  });

  it('sendMessage는 등록된 MCP 서버가 ready가 될 때까지 turn/start를 지연한다', async () => {
    connection = new TestCodexAppServerConnection(child, {
      mcpServerNames: ['test-math'],
      mcpStartupTimeout: 1_000,
    });
    await establishSession(connection, child);

    const sendPromise = connection.sendMessage([
      {
        type: 'text',
        text: 'MCP 도구를 사용해줘',
        text_elements: [],
      },
    ]);

    await flushMicrotask();
    expect(readOutgoingMethods(child)).toEqual([
      'initialize',
      'thread/start',
    ]);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('mcpServer/startupStatus/updated', {
        name: 'test-math',
        status: 'ready',
        error: null,
      })}\n`,
    );
    await flushMicrotask();
    expect(readOutgoingMethods(child)).toEqual([
      'initialize',
      'thread/start',
      'turn/start',
    ]);

    child.stdout.emit('data', `${jsonRpcResult(3, { turn: { id: 'turn-mcp' } })}\n`);
    child.stdout.emit(
      'data',
      `${jsonRpcNotification('turn/completed', {
        threadId: 'thread-1',
        turn: {
          id: 'turn-mcp',
          status: 'completed',
          error: null,
        },
      })}\n`,
    );

    await sendPromise;
  });

  it('sendMessage는 MCP 서버 시작 실패를 turn/start 전에 반환한다', async () => {
    connection = new TestCodexAppServerConnection(child, {
      mcpServerNames: ['test-math'],
      mcpStartupTimeout: 1_000,
    });
    await establishSession(connection, child);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('mcpServer/startupStatus/updated', {
        name: 'test-math',
        status: 'failed',
        error: { message: '연결 실패' },
      })}\n`,
    );

    await expect(connection.sendMessage([
      {
        type: 'text',
        text: 'MCP 도구를 사용해줘',
        text_elements: [],
      },
    ])).rejects.toThrow("Codex MCP server 'test-math' failed to start: 연결 실패");
    expect(readOutgoingMethods(child)).toEqual([
      'initialize',
      'thread/start',
    ]);
  });

  it('failed turn/completed는 promptComplete 없이 error로 sendMessage를 거절한다', async () => {
    await establishSession(connection, child);
    const promptComplete = vi.fn();
    const errors: string[] = [];
    connection.on('promptComplete', promptComplete);
    connection.on('error', (error: Error) => {
      errors.push(error.message);
    });

    const sendPromise = connection.sendMessage([
      {
        type: 'text',
        text: '실패 테스트',
        text_elements: [],
      },
    ]);

    await flushMicrotask();
    child.stdout.emit('data', `${jsonRpcResult(3, { turn: { id: 'turn-failed' } })}\n`);
    child.stdout.emit(
      'data',
      `${jsonRpcNotification('turn/completed', {
        threadId: 'thread-1',
        turn: {
          id: 'turn-failed',
          status: 'failed',
          error: { message: '모델 실패' },
        },
      })}\n`,
    );

    await expect(sendPromise).rejects.toThrow('모델 실패');
    expect(promptComplete).not.toHaveBeenCalled();
    expect(errors).toEqual(['모델 실패']);
  });

  it('cancelPrompt가 turn/interrupt를 호출한다', async () => {
    await establishSession(connection, child);
    await startTurn(connection, child, 'turn-7');

    const cancelPromise = connection.cancelPrompt();

    expect(readOutgoingMethods(child)).toContain('turn/interrupt');
    expect(lastOutgoingMessage(child)).toMatchObject({
      method: 'turn/interrupt',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-7',
      },
    });
    child.stdout.emit('data', `${jsonRpcResult(4, {})}\n`);
    await cancelPromise;
  });

  it('endSession이 thread/archive를 보내고 프로세스는 유지한다', async () => {
    await establishSession(connection, child);
    await startTurn(connection, child, 'turn-9');

    const endPromise = connection.endSession();

    expect(readOutgoingMethods(child)).toContain('turn/interrupt');
    child.stdout.emit('data', `${jsonRpcResult(4, {})}\n`);
    await flushMicrotask();
    child.stdout.emit('data', `${jsonRpcResult(5, {})}\n`);

    await endPromise;

    expect(connection.sessionId).toBeNull();
    expect(child.kill).not.toHaveBeenCalled();
    expect(lastOutgoingMessage(child)).toMatchObject({
      method: 'thread/archive',
      params: {
        threadId: 'thread-1',
      },
    });
  });

  it('disconnect가 프로세스를 종료한다', async () => {
    await establishSession(connection, child);

    const disconnectPromise = connection.disconnect();
    child.stdout.emit('data', `${jsonRpcResult(3, {})}\n`);

    await disconnectPromise;

    expect(child.kill).toHaveBeenCalled();
  });

  it('stderr를 log/logEntry로 전달한다', async () => {
    const logs: string[] = [];
    const entries: string[] = [];

    connection.on('log', (message) => logs.push(message));
    connection.on('logEntry', (entry) => entries.push(entry.message));

    const connectPromise = connection.connect();
    child.stderr.emit('data', '첫 줄\n둘');
    child.stderr.emit('data', '째 줄\n');
    child.stdout.emit(
      'data',
      `${jsonRpcResult(1, {
        userAgent: 'codex/test',
        codexHome: '/tmp/codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      })}\n`,
    );
    await flushMicrotask();
    child.stdout.emit('data', `${jsonRpcResult(2, { thread: { id: 'thread-1' } })}\n`);
    await connectPromise;

    expect(logs).toEqual(['첫 줄', '둘째 줄']);
    expect(entries).toEqual(['첫 줄', '둘째 줄']);
  });
});

async function establishSession(
  connection: TestCodexAppServerConnection,
  child: MockChildProcess,
): Promise<void> {
  const connectPromise = connection.connect();
  child.stdout.emit(
    'data',
    `${jsonRpcResult(1, {
      userAgent: 'codex/test',
      codexHome: '/tmp/codex',
      platformFamily: 'unix',
      platformOs: 'macos',
    })}\n`,
  );
  await flushMicrotask();
  child.stdout.emit('data', `${jsonRpcResult(2, { thread: { id: 'thread-1' } })}\n`);
  await connectPromise;
}

async function startTurn(
  connection: TestCodexAppServerConnection,
  child: MockChildProcess,
  turnId: string,
): Promise<void> {
  const sendPromise = connection.sendMessage([
    {
      type: 'text',
      text: '테스트',
      text_elements: [],
    },
  ]);
  await flushMicrotask();
  child.stdout.emit('data', `${jsonRpcResult(3, { turn: { id: turnId } })}\n`);
  child.stdout.emit(
    'data',
    `${jsonRpcNotification('turn/completed', {
      threadId: 'thread-1',
      turn: { id: turnId, status: 'completed', error: null },
    })}\n`,
  );
  await sendPromise;
}

function readOutgoingMethods(child: MockChildProcess): string[] {
  return child.stdin.write.mock.calls
    .map(([chunk]) => parseOutgoingChunk(chunk as string))
    .map((message) => (typeof message.method === 'string' ? message.method : ''));
}

function lastOutgoingMessage(child: MockChildProcess): Record<string, unknown> {
  const lastCall = child.stdin.write.mock.calls.at(-1);
  expect(lastCall).toBeTruthy();
  return parseOutgoingChunk(lastCall?.[0] as string);
}

function parseOutgoingChunk(chunk: string): Record<string, unknown> {
  return JSON.parse(chunk.trim()) as Record<string, unknown>;
}

function jsonRpcResult(id: number, result: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function jsonRpcNotification(method: string, params: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
  });
}

async function flushMicrotask(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
