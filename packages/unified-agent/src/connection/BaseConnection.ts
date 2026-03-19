/**
 * BaseConnection - 프로세스 Spawn + Stream 관리 기반 클래스
 * child_process.spawn으로 CLI를 실행하고, 공식 ACP SDK용 Stream을 생성합니다.
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk';
import type { ConnectionState } from '../types/common.js';
import { isWindows } from '../utils/env.js';
import { killProcess } from '../utils/process.js';

/** BaseConnection 생성 옵션 */
export interface BaseConnectionOptions {
  /** 실행 커맨드 */
  command: string;
  /** 커맨드 인자 */
  args: string[];
  /** 작업 디렉토리 */
  cwd: string;
  /** 환경변수 */
  env?: Record<string, string | undefined>;
  /** 요청 타임아웃 (ms, 기본: 300000) */
  requestTimeout?: number;
  /** 초기화 타임아웃 (ms, 기본: 60000) */
  initTimeout?: number;
}

/**
 * 프로세스 Spawn + Stream 관리 기반 클래스.
 * child_process.spawn으로 CLI 프로세스를 생성하고,
 * Node.js Stream → Web Streams 변환을 통해 공식 ACP SDK 호환 Stream을 제공합니다.
 */
export class BaseConnection extends EventEmitter {
  protected child: ChildProcess | null = null;
  protected state: ConnectionState = 'disconnected';
  protected acpStream: Stream | null = null;
  protected childExitPromise: Promise<void> | null = null;

  protected readonly command: string;
  protected readonly args: string[];
  protected readonly cwd: string;
  protected readonly env: Record<string, string | undefined>;
  protected readonly requestTimeout: number;
  protected readonly initTimeout: number;

  constructor(options: BaseConnectionOptions) {
    super();
    this.command = options.command;
    this.args = options.args;
    this.cwd = options.cwd;
    this.env = options.env ?? { ...process.env };
    this.requestTimeout = options.requestTimeout ?? 600_000; // 10분
    this.initTimeout = options.initTimeout ?? 60_000; // 60초
  }

  /** 현재 연결 상태 */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * CLI 프로세스를 spawn하고 기본 이벤트 핸들링을 설정합니다.
   * stderr 로그 수집, 프로세스 종료/에러 처리를 포함합니다.
   * ACP ndJsonStream 변환 없이 raw child process만 반환합니다.
   *
   * @returns spawn된 child process
   */
  protected spawnRawProcess(): ChildProcess {
    this.setState('connecting');

    // Windows에서 .cmd 래퍼(npx.cmd, gemini.cmd 등)를 실행하려면 cmd.exe가 필요합니다.
    // shell: true를 사용하면 Node.js가 내부적으로 cmd.exe /d /s /c "..." 형태로 감싸면서
    // windowsVerbatimArguments=true를 강제하고 stdio 파이프가 불안정해집니다 (EPIPE).
    // cmd.exe /c를 직접 spawn(shell: false)하면 Node.js 기본 인자 이스케이프가 적용되어
    // stdio 파이프가 안정적으로 동작합니다.
    const command = isWindows()
      ? ((this.env.ComSpec as string) ?? 'cmd.exe')
      : this.command;
    const args = isWindows()
      ? ['/c', this.command, ...this.args]
      : this.args;

    const child = spawn(command, args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env as NodeJS.ProcessEnv,
    });

    this.childExitPromise = new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve();
      });
    });

    // stderr 로그 수집
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.emit('log', line.trim());
        }
      }
    });

    // 프로세스 종료 처리
    child.on('exit', (code, signal) => {
      this.setState('closed');
      this.emit('exit', code, signal);
    });

    // 프로세스 에러 처리
    child.on('error', (err) => {
      this.setState('error');
      this.emit('error', err);
    });

    this.child = child;
    return child;
  }

  /**
   * CLI 프로세스를 spawn하고 ACP SDK 호환 Stream을 생성합니다.
   * spawnRawProcess()를 호출한 후 ndJsonStream 변환을 추가합니다.
   *
   * @returns 공식 ACP SDK의 Stream (ndJsonStream)
   */
  protected spawnProcess(): { child: ChildProcess; stream: Stream } {
    const child = this.spawnRawProcess();

    // Node.js Stream → Web Streams 변환
    const webWritable = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
    const webReadable = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;

    // 공식 ACP SDK의 ndJsonStream으로 변환
    const stream = ndJsonStream(webWritable, webReadable);

    this.acpStream = stream;
    this.setState('connected');

    return { child, stream };
  }

  /**
   * 연결을 닫고 프로세스를 종료합니다.
   */
  async disconnect(): Promise<void> {
    if (this.child) {
      const child = this.child;
      const exitPromise = this.childExitPromise ?? this.createExitPromise(child);

      killProcess(child);
      await this.waitForExit(exitPromise, 5000);

      this.child = null;
      this.childExitPromise = null;
    }
    this.acpStream = null;
    this.setState('disconnected');
  }

  /**
   * 연결 상태를 업데이트하고 이벤트를 발생시킵니다.
   */
  protected setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('stateChange', newState);
    }
  }

  /**
   * 이미 종료된 프로세스를 고려해 exit 대기 Promise를 생성합니다.
   */
  private createExitPromise(child: ChildProcess): Promise<void> {
    if (child.exitCode != null || child.signalCode != null) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve();
      });
    });
  }

  /**
   * 프로세스 종료를 지정 시간까지 대기합니다.
   */
  private async waitForExit(
    exitPromise: Promise<void>,
    timeoutMs: number,
  ): Promise<void> {
    if (timeoutMs <= 0) {
      await exitPromise;
      return;
    }

    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }
}
