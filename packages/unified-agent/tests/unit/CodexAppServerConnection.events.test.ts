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
  pid = 5678;
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
  constructor(private readonly mockChild: MockChildProcess) {
    super({
      command: 'codex',
      args: ['app-server', '--listen', 'stdio://'],
      cwd: process.cwd(),
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

describe('CodexAppServerConnection events', () => {
  let child: MockChildProcess;
  let connection: TestCodexAppServerConnection;

  beforeEach(async () => {
    child = new MockChildProcess();
    connection = new TestCodexAppServerConnection(child);
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
  });

  it('final_answer agentMessage delta를 messageChunk로 승격한다', () => {
    const messageHandler = vi.fn();
    connection.on('messageChunk', messageHandler);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('item/started', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'agentMessage',
          id: 'item-1',
          text: '',
          phase: 'final_answer',
          memoryCitation: null,
        },
      })}\n${jsonRpcNotification('item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: '응답 청크',
      })}\n`,
    );

    expect(messageHandler).toHaveBeenCalledWith('응답 청크', 'thread-1');
  });

  it('commentary agentMessage delta도 messageChunk로 승격한다', () => {
    const messageHandler = vi.fn();
    connection.on('messageChunk', messageHandler);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('item/started', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'agentMessage',
          id: 'item-commentary',
          text: '',
          phase: 'commentary',
          memoryCitation: null,
        },
      })}\n${jsonRpcNotification('item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-commentary',
        delta: '도구 확인 중',
      })}\n`,
    );

    expect(messageHandler).toHaveBeenCalledWith('도구 확인 중', 'thread-1');
  });

  it('MCP startup status notification을 상태 이벤트로 승격한다', () => {
    const statusHandler = vi.fn();
    const logHandler = vi.fn();
    connection.on('mcpServerStatus', statusHandler);
    connection.on('log', logHandler);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('mcpServer/startupStatus/updated', {
        name: 'test-math',
        status: 'ready',
        error: null,
      })}\n`,
    );

    expect(statusHandler).toHaveBeenCalledWith({
      name: 'test-math',
      status: 'ready',
      error: null,
    });
    expect(logHandler).not.toHaveBeenCalledWith(
      '[codex-native] unhandled notification: mcpServer/startupStatus/updated',
    );
  });

  it('reasoning delta들을 thoughtChunk로 승격한다', () => {
    const handler = vi.fn();
    connection.on('thoughtChunk', handler);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('item/reasoning/textDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-2',
        delta: '생각 1',
        contentIndex: 0,
      })}\n${jsonRpcNotification('item/reasoning/summaryTextDelta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-2',
        delta: '생각 2',
        summaryIndex: 0,
      })}\n`,
    );

    expect(handler).toHaveBeenNthCalledWith(1, '생각 1', 'thread-1');
    expect(handler).toHaveBeenNthCalledWith(2, '생각 2', 'thread-1');
  });

  it('mcpToolCall 시작/진행/완료를 toolCall/toolCallUpdate로 매핑한다', () => {
    const toolCall = vi.fn();
    const toolCallUpdate = vi.fn();
    connection.on('toolCall', toolCall);
    connection.on('toolCallUpdate', toolCallUpdate);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('item/started', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'item-3',
          server: 'github',
          tool: 'search',
          status: 'inProgress',
          arguments: {},
          result: null,
          error: null,
          durationMs: null,
        },
      })}\n${jsonRpcNotification('item/mcpToolCall/progress', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-3',
        message: '검색 중',
      })}\n${jsonRpcNotification('item/completed', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'item-3',
          server: 'github',
          tool: 'search',
          status: 'completed',
          arguments: {},
          result: { ok: true },
          error: null,
          durationMs: 10,
        },
      })}\n`,
    );

    expect(toolCall).toHaveBeenCalledWith(
      'github/search',
      'in_progress',
      'thread-1',
      expect.objectContaining({ type: 'mcpToolCall' }),
    );
    expect(toolCallUpdate).toHaveBeenNthCalledWith(
      1,
      '검색 중',
      'in_progress',
      'thread-1',
    );
    expect(toolCallUpdate).toHaveBeenNthCalledWith(
      2,
      'github/search',
      'completed',
      'thread-1',
      expect.objectContaining({ type: 'mcpToolCall' }),
    );
  });

  it('plan delta와 turn completed를 매핑한다', () => {
    const plan = vi.fn();
    const complete = vi.fn();
    connection.on('plan', plan);
    connection.on('promptComplete', complete);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('plan/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'plan-1',
        delta: '1. 구현',
      })}\n${jsonRpcNotification('turn/completed', {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'completed',
          error: null,
        },
      })}\n`,
    );

    expect(plan).toHaveBeenCalledWith('1. 구현', 'thread-1');
    expect(complete).toHaveBeenCalledWith('thread-1');
  });

  it('approval server request를 permissionRequest로 브리지하고 JSON-RPC response로 응답한다', () => {
    const permissionRequest = vi.fn((_params, resolve: (response: { optionId: string }) => void) => {
      resolve({ optionId: 'decision_1' });
    });
    connection.on('permissionRequest', permissionRequest);

    child.stdout.emit(
      'data',
      `${jsonRpcServerRequest(77, 'item/commandExecution/requestApproval', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-approve',
        command: 'npm test',
        reason: '테스트 실행',
        availableDecisions: ['accept', 'decline'],
      })}\n`,
    );

    expect(permissionRequest).toHaveBeenCalledWith(
      {
        toolName: 'commandExecution',
        toolInput: 'npm test',
        permissions: [
          { id: 'decision_0', label: 'accept', description: '테스트 실행' },
          { id: 'decision_1', label: 'decline', description: '테스트 실행' },
        ],
      },
      expect.any(Function),
    );
    expect(lastOutgoingMessage(child)).toEqual({
      jsonrpc: '2.0',
      id: 77,
      result: {
        decision: 'decline',
      },
    });
  });

  it('willRetry=false error만 error 이벤트로 전달한다', () => {
    const handler = vi.fn();
    connection.on('error', handler);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('error', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        willRetry: true,
        error: {
          message: '재시도 예정',
          codexErrorInfo: null,
          additionalDetails: null,
        },
      })}\n${jsonRpcNotification('error', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        willRetry: false,
        error: {
          message: '최종 실패',
          codexErrorInfo: null,
          additionalDetails: null,
        },
      })}\n`,
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ message: '최종 실패' }));
  });

  it('미매핑 notification은 로그로 남긴다', () => {
    const handler = vi.fn();
    connection.on('log', handler);

    child.stdout.emit(
      'data',
      `${jsonRpcNotification('thread/nameUpdated', {
        threadId: 'thread-1',
      })}\n`,
    );

    expect(handler).toHaveBeenCalledWith(
      '[codex-native] unhandled notification: thread/nameUpdated',
    );
  });
});

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

function jsonRpcServerRequest(id: number, method: string, params: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });
}

function lastOutgoingMessage(child: MockChildProcess): Record<string, unknown> {
  const lastCall = child.stdin.write.mock.calls.at(-1);
  expect(lastCall).toBeTruthy();
  return JSON.parse((lastCall?.[0] as string).trim()) as Record<string, unknown>;
}

async function flushMicrotask(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
