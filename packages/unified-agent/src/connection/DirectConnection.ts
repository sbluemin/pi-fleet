/**
 * DirectConnection - CLI 직접 실행 연결
 * ACP 프로토콜을 우회하여 CLI를 직접 spawn하고 JSONL 출력을 파싱합니다.
 */

import { createInterface, type Interface as ReadlineInterface } from 'readline';
import type { ChildProcess } from 'child_process';
import { BaseConnection, type BaseConnectionOptions } from './BaseConnection.js';
import { OUTPUT_PARSERS } from './parsers/index.js';
import type { DirectExecOptions, DirectExecResult } from '../types/direct.js';

/** DirectConnection 생성 옵션 */
export interface DirectConnectionOptions extends BaseConnectionOptions {
  /** 출력 파서 타입 키 (OUTPUT_PARSERS 레지스트리에서 조회) */
  parserType: string;
}

/**
 * CLI를 직접 실행하고 JSONL 출력을 파싱하는 연결 클래스.
 * BaseConnection을 상속하여 프로세스 spawn, 종료 관리를 재사용합니다.
 */
export class DirectConnection extends BaseConnection {
  private readonly parserType: string;
  private threadId: string | null = null;
  private readline: ReadlineInterface | null = null;

  constructor(options: DirectConnectionOptions) {
    super(options);
    this.parserType = options.parserType;
  }

  /**
   * 프롬프트를 실행합니다.
   * CLI 프로세스를 spawn하고 JSONL 출력을 파싱하여 이벤트를 발생시킵니다.
   *
   * @param _options - 실행 옵션 (인자는 생성자에서 이미 설정됨, 향후 확장용)
   * @returns 실행 결과
   */
  async execute(_options?: Partial<DirectExecOptions>): Promise<DirectExecResult> {
    const parser = OUTPUT_PARSERS[this.parserType];
    if (!parser) {
      throw new Error(`알 수 없는 출력 파서 타입: "${this.parserType}"`);
    }

    // 프로세스 spawn (BaseConnection의 spawnRawProcess 사용)
    const child: ChildProcess = this.spawnRawProcess();
    this.setState('connected');

    let fullResponse = '';

    // JSONL stdout 파싱
    this.readline = createInterface({ input: child.stdout! });

    this.readline.on('line', (line: string) => {
      const event = parser(line);
      if (!event) {
        // 파싱 불가 라인은 로그로 전달
        if (line.trim()) {
          this.emit('log', line);
        }
        return;
      }

      switch (event.type) {
        case 'threadStarted':
          this.threadId = event.threadId ?? null;
          break;

        case 'messageChunk':
          if (event.text) {
            fullResponse += event.text;
            this.emit('messageChunk', event.text, this.threadId ?? '');
          }
          break;

        case 'toolCall':
          if (event.title) {
            this.emit('toolCall', event.title, 'running', this.threadId ?? '');
          }
          break;

        case 'turnCompleted':
          this.emit('promptComplete', this.threadId ?? '');
          break;
      }
    });

    // 프로세스 종료 대기
    // child 'error'는 BaseConnection.spawnRawProcess()에서 이미 emit하므로 중복 방지
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });

    return {
      response: fullResponse,
      sessionId: this.threadId,
      exitCode,
    };
  }

  /**
   * 현재 세션 ID를 반환합니다.
   */
  getSessionId(): string | null {
    return this.threadId;
  }

  /**
   * 연결을 닫고 리소스를 정리합니다.
   */
  async disconnect(): Promise<void> {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    await super.disconnect();
  }
}
