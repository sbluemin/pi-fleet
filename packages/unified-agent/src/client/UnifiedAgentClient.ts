/**
 * UnifiedAgentClient - 통합 에이전트 클라이언트
 * 모든 CLI를 하나의 인터페이스로 통합하는 최상위 클래스
 */

import { EventEmitter } from 'events';
import type { PromptResponse } from '@agentclientprotocol/sdk';
import type {
  CliType,
  UnifiedClientOptions,
  CliDetectionResult,
  AgentMode,
} from '../types/config.js';
import type {
  AcpContentBlock,
  AcpSessionUpdateParams,
  AcpPermissionRequestParams,
  AcpPermissionResponse,
  AcpFileReadParams,
  AcpFileReadResponse,
  AcpFileWriteParams,
  AcpFileWriteResponse,
  AcpSessionNewResult,
} from '../types/acp.js';
import type { ConnectionState } from '../types/common.js';
import type {
  IUnifiedAgentClient,
  ConnectResult,
  ConnectionInfo,
  UnifiedClientEvents,
} from './IUnifiedAgentClient.js';
import { AcpConnection } from '../connection/AcpConnection.js';
import { DirectConnection } from '../connection/DirectConnection.js';
import type { DirectExecResult } from '../types/direct.js';
import { CliDetector } from '../detector/CliDetector.js';
import {
  createSpawnConfig,
  createDirectSpawnConfig,
  getBackendConfig,
  getYoloModeId,
} from '../config/CliConfigs.js';
import { cleanEnvironment, isWindows } from '../utils/env.js';
import { getProviderModels } from '../models/ModelRegistry.js';
import type { ProviderModelInfo } from '../models/schemas.js';

// 인터페이스 파일에서 타입 re-export
export type { UnifiedClientEvents, ConnectResult, ConnectionInfo, IUnifiedAgentClient } from './IUnifiedAgentClient.js';

/**
 * 통합 에이전트 클라이언트.
 * CLI 자동 감지, ACP 프로토콜 추상화, 이벤트 기반 스트리밍을 제공합니다.
 */
export class UnifiedAgentClient extends EventEmitter implements IUnifiedAgentClient {
  private acpConnection: AcpConnection | null = null;
  private directConnection: DirectConnection | null = null;
  private directOptions: UnifiedClientOptions | null = null;
  private directState: ConnectionState = 'disconnected';
  private activeCli: CliType | null = null;
  private sessionId: string | null = null;
  private sessionCwd: string | null = null;
  private detector = new CliDetector();

  /** 현재 프롬프트에서 텍스트가 emit된 적 있는지 */
  private hasPendingText = false;
  /** 다음 messageChunk 앞에 턴 구분자(\n\n) 삽입이 필요한지 */
  private needsTurnSeparator = false;

  /** 타입 안전한 이벤트 리스너 등록 */
  on<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  /** 타입 안전한 1회성 이벤트 리스너 등록 */
  once<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  /** 타입 안전한 이벤트 리스너 해제 */
  off<K extends keyof UnifiedClientEvents>(
    event: K,
    listener: (...args: UnifiedClientEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  /** 타입 안전한 이벤트 발생 */
  private emitTyped<K extends keyof UnifiedClientEvents>(
    event: K,
    ...args: UnifiedClientEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  /** messageChunk 전파 (턴 경계 구분자 삽입 포함) */
  private forwardMessageChunk(text: string, sessionId: string): void {
    if (this.needsTurnSeparator) {
      this.needsTurnSeparator = false;
      text = '\n\n' + text;
    }
    this.hasPendingText = true;
    this.emitTyped('messageChunk', text, sessionId);
  }

  /** toolCall 전파 (텍스트가 있었으면 턴 경계 플래그 설정) */
  private forwardToolCall(title: string, status: string, sessionId: string): void {
    if (this.hasPendingText) {
      this.needsTurnSeparator = true;
    }
    this.emitTyped('toolCall', title, status, sessionId);
  }

  /**
   * CLI에 연결합니다.
   *
   * @param options - 연결 옵션
   * @returns 연결 결과
   */
  async connect(options: UnifiedClientOptions): Promise<ConnectResult> {
    // 기존 연결 정리
    await this.disconnect();

    // 세션 재개 시 CLI 미지정 방지 (자동 감지로 엉뚱한 CLI에 재개 시도하는 문제 차단)
    if (options.sessionId && !options.cli) {
      throw new Error('세션 재개 시 cli 지정이 필요합니다.');
    }

    // Direct 모드 분기
    if (options.direct) {
      if (!options.cli) {
        throw new Error('direct 모드 사용 시 cli 지정이 필요합니다.');
      }
      return this.connectDirect(options.cli, options);
    }

    // CLI 선택: 명시적 지정 → 자동 감지 순서
    if (options.cli) {
      return this.connectAcp(options.cli, options);
    }

    const preferred = await this.detector.getPreferred();
    if (!preferred) {
      throw new Error(
        '사용 가능한 CLI가 없습니다. gemini, claude, codex 중 하나를 설치해주세요.',
      );
    }

    return this.connectAcp(preferred.cli, options);
  }

  /**
   * ACP 프로토콜로 연결합니다.
   */
  private async connectAcp(
    cli: CliType,
    options: UnifiedClientOptions,
  ): Promise<ConnectResult> {
    const spawnConfig = createSpawnConfig(cli, options);
    const cleanEnv = cleanEnvironment(process.env, options.env);

    const env: Record<string, string | undefined> = { ...cleanEnv };

    if (cli === 'gemini' && isWindows() && env.GEMINI_CLI_NO_RELAUNCH === undefined) {
      // Gemini CLI는 Windows에서 self-relaunch 경로를 타면 ACP stdio 핸드셰이크가 멈출 수 있어 비활성화합니다.
      env.GEMINI_CLI_NO_RELAUNCH = 'true';
    }

    this.acpConnection = new AcpConnection({
      command: spawnConfig.command,
      args: spawnConfig.args,
      cwd: options.cwd,
      env,
      requestTimeout: options.timeout,
      initTimeout: options.timeout,
      clientInfo: options.clientInfo,
      autoApprove: options.autoApprove,
    });

    // 이벤트 전파
    this.setupAcpEventForwarding();

    const recentLogs: string[] = [];
    const collectLog = (message: string): void => {
      recentLogs.push(message);
      if (recentLogs.length > 30) {
        recentLogs.shift();
      }
    };
    this.acpConnection.on('log', collectLog);

    let session: AcpSessionNewResult;
    try {
      // 연결 실행
      session = await this.acpConnection.connect(options.cwd, options.sessionId);
    } catch (error) {
      const connectionError = this.buildConnectionError(cli, error, recentLogs);
      await this.cleanupFailedAcpConnection();
      throw connectionError;
    } finally {
      this.acpConnection?.off('log', collectLog);
    }

    // YOLO 모드 설정
    if (options.yoloMode && session.sessionId) {
      try {
        await this.acpConnection.setMode(session.sessionId, getYoloModeId(cli));
      } catch {
        // YOLO 모드 미지원 CLI인 경우 무시
      }
    }

    // 모델 설정
    if (options.model && session.sessionId) {
      try {
        await this.acpConnection.setModel(session.sessionId, options.model);
      } catch {
        // 모델 설정 미지원 CLI인 경우 무시
      }
    }

    this.activeCli = cli;
    this.sessionId = session.sessionId;
    this.sessionCwd = options.cwd;

    return {
      cli,
      protocol: 'acp',
      session,
    };
  }

  /**
   * Direct 모드로 연결합니다.
   * 실제 spawn은 sendMessage() 시점에 수행합니다.
   */
  private connectDirect(
    cli: CliType,
    options: UnifiedClientOptions,
  ): ConnectResult {
    const backend = getBackendConfig(cli);
    if (!backend.directConfig) {
      throw new Error(`"${cli}"는 direct 모드를 지원하지 않습니다.`);
    }

    this.activeCli = cli;
    this.sessionCwd = options.cwd;
    this.directOptions = options;
    // connect 시 전달된 sessionId를 즉시 반영 (세션 resume 지원)
    if (options.sessionId) {
      this.sessionId = options.sessionId;
    }
    // direct 모드는 connect 시점에 프로세스를 spawn하지 않지만,
    // SDK 소비자에게 "사용 가능" 상태를 알리기 위해 connected로 설정
    this.directState = 'connected';

    return {
      cli,
      protocol: 'direct',
      // direct 모드에서도 sessionId를 ConnectResult에 포함 (ACP와 일관된 인터페이스)
      session: options.sessionId ? { sessionId: options.sessionId } : undefined,
    };
  }

  /**
   * 메시지를 전송합니다.
   *
   * @param content - 메시지 내용 (텍스트 또는 ACP ContentBlock 배열)
   * @returns 프롬프트 처리 결과
   */
  async sendMessage(content: string | AcpContentBlock[]): Promise<PromptResponse> {
    this.hasPendingText = false;
    this.needsTurnSeparator = false;

    // Direct 모드 실행
    if (this.directOptions && this.activeCli) {
      if (typeof content !== 'string') {
        throw new Error('direct 모드에서는 텍스트 프롬프트만 지원합니다.');
      }
      // 동시 실행 방어: 이전 프로세스가 아직 살아있으면 에러
      if (this.directConnection && this.directConnection.connectionState === 'connected') {
        throw new Error('이미 direct 프롬프트가 실행 중입니다.');
      }
      const result = await this.executeDirect(content);
      this.sessionId = result.sessionId;

      // 다중 턴 세션 유지: 이후 sendMessage() 호출에서 세션 재개
      if (result.sessionId) {
        this.directOptions = { ...this.directOptions, sessionId: result.sessionId };
      }

      if (result.exitCode !== 0) {
        throw new Error(`direct 모드 실행 실패 (exit code: ${result.exitCode})`);
      }

      return {
        stopReason: 'end_turn',
      } satisfies PromptResponse;
    }

    if (this.acpConnection && this.sessionId) {
      return this.acpConnection.sendPrompt(this.sessionId, content);
    }

    throw new Error('연결되어 있지 않습니다');
  }

  /**
   * Direct 모드로 프롬프트를 실행합니다.
   */
  private async executeDirect(prompt: string): Promise<DirectExecResult> {
    // 이전 directConnection 정리 (다중 턴 시 리스너 누수 방지)
    if (this.directConnection) {
      this.directConnection.removeAllListeners();
      this.directConnection = null;
    }

    const options = this.directOptions!;
    const cli = this.activeCli!;
    const backend = getBackendConfig(cli);

    const spawnConfig = createDirectSpawnConfig(cli, {
      prompt,
      model: options.model,
      effort: options.effort,
      cwd: options.cwd,
      yolo: options.yoloMode ?? false,
      sessionId: options.sessionId,
    }, options.cliPath);

    const cleanEnv = cleanEnvironment(process.env, options.env);

    this.directConnection = new DirectConnection({
      command: spawnConfig.command,
      args: spawnConfig.args,
      cwd: options.cwd,
      env: cleanEnv,
      parserType: backend.directConfig!.outputParserType,
    });

    // 이벤트 전파
    this.setupDirectEventForwarding();

    const result = await this.directConnection.execute();
    return result;
  }

  /**
   * 현재 진행 중인 프롬프트를 취소합니다.
   */
  async cancelPrompt(): Promise<void> {
    if (this.directConnection) {
      await this.directConnection.disconnect();
      return;
    }
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.cancelSession(this.sessionId);
  }

  /**
   * 모델을 변경합니다.
   *
   * @param model - 모델 이름
   */
  async setModel(model: string): Promise<void> {
    if (this.directOptions) {
      // direct 모드에서는 다음 실행 시 적용
      this.directOptions = { ...this.directOptions, model };
      return;
    }
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setModel(this.sessionId, model);
  }

  /**
   * 세션 설정 옵션을 변경합니다.
   *
   * @param configId - 설정 옵션 ID
   * @param value - 설정 값
   */
  async setConfigOption(configId: string, value: string): Promise<void> {
    if (this.directOptions) {
      // direct 모드에서 effort는 옵션으로 전달
      if (configId === 'reasoning_effort') {
        this.directOptions = { ...this.directOptions, effort: value };
        return;
      }
      // 그 외 설정은 direct 모드에서 미지원
      return;
    }
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setConfigOption(this.sessionId, configId, value);
  }

  /**
   * 에이전트 모드를 설정합니다.
   * CLI별 지원 모드: Gemini(default/autoEdit/yolo), Claude(default/plan/bypassPermissions), Codex(default/autoEdit/yolo) 등.
   *
   * @param mode - 모드 ID (e.g., 'plan', 'yolo', 'bypassPermissions')
   */
  async setMode(mode: string): Promise<void> {
    if (this.directOptions) {
      // direct 모드에서 모드 변경은 미지원
      return;
    }
    if (!this.acpConnection || !this.sessionId) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.acpConnection.setMode(this.sessionId, mode);
  }

  /**
   * YOLO 모드를 설정합니다.
   * setMode()의 편의 래퍼입니다.
   *
   * @param enabled - 활성화 여부
   */
  async setYoloMode(enabled: boolean): Promise<void> {
    if (this.directOptions) {
      // direct 모드에서는 다음 실행 시 적용
      this.directOptions = { ...this.directOptions, yoloMode: enabled };
      return;
    }
    if (!enabled) {
      return this.setMode('default');
    }
    if (!this.activeCli) {
      throw new Error('연결되어 있지 않습니다');
    }
    return this.setMode(getYoloModeId(this.activeCli));
  }

  /**
   * 현재 CLI에서 사용 가능한 에이전트 모드 목록을 반환합니다.
   *
   * @returns 모드 목록 (모드 미지원 시 빈 배열)
   */
  getAvailableModes(): AgentMode[] {
    if (!this.activeCli) return [];
    const config = getBackendConfig(this.activeCli);
    return config.modes ?? [];
  }

  /**
   * 사용 가능한 모델 목록을 정적 레지스트리에서 반환합니다.
   *
   * @param cli - CLI 타입 (생략 시 현재 연결된 CLI)
   * @returns 프로바이더 모델 정보 (연결 전이고 cli 미지정 시 null)
   */
  getAvailableModels(cli?: CliType): ProviderModelInfo | null {
    const target = cli ?? this.activeCli;
    if (!target) return null;
    return getProviderModels(target);
  }

  /**
   * 기존 세션을 로드합니다.
   *
   * @param sessionId - 로드할 세션 ID
   */
  async loadSession(sessionId: string): Promise<void> {
    if (!this.acpConnection) {
      throw new Error('연결되어 있지 않습니다');
    }

    await this.acpConnection.loadSession({
      sessionId,
      cwd: this.sessionCwd ?? process.cwd(),
      mcpServers: [],
    });

    this.sessionId = sessionId;
  }

  /**
   * Direct 모드에서 세션 ID를 외부에서 갱신합니다.
   * 풀 클라이언트가 재사용될 때 세션 매핑에서 복원된 sessionId를 반영합니다.
   */
  setDirectSessionId(sessionId: string): void {
    if (!this.directOptions) {
      throw new Error('direct 모드에서만 사용 가능합니다.');
    }
    this.sessionId = sessionId;
    this.directOptions = { ...this.directOptions, sessionId };
  }

  /**
   * 사용 가능한 CLI 목록을 감지합니다.
   */
  async detectClis(): Promise<CliDetectionResult[]> {
    return this.detector.detectAll(true);
  }

  /**
   * 연결 정보를 반환합니다.
   */
  getConnectionInfo(): ConnectionInfo {
    const state: ConnectionState = this.acpConnection
      ? this.acpConnection.connectionState
      : this.directOptions
        ? this.directState
        : 'disconnected';

    const protocol = this.directOptions
      ? 'direct'
      : this.activeCli ? 'acp' : null;

    return {
      cli: this.activeCli,
      protocol,
      sessionId: this.sessionId,
      state,
    };
  }

  /**
   * 연결을 닫습니다.
   */
  async disconnect(): Promise<void> {
    if (this.acpConnection) {
      await this.acpConnection.disconnect();
      this.acpConnection.removeAllListeners();
      this.acpConnection = null;
    }

    if (this.directConnection) {
      await this.directConnection.disconnect();
      this.directConnection.removeAllListeners();
      this.directConnection = null;
    }

    this.activeCli = null;
    this.sessionId = null;
    this.sessionCwd = null;
    this.directOptions = null;
    this.directState = 'disconnected';
  }

  /**
   * ACP 이벤트를 통합 클라이언트로 전파합니다.
   */
  private setupAcpEventForwarding(): void {
    if (!this.acpConnection) return;

    this.acpConnection.on('stateChange', (state: ConnectionState) => {
      this.emitTyped('stateChange', state);
    });
    this.acpConnection.on('userMessageChunk', (text: string, sessionId: string) => {
      this.emitTyped('userMessageChunk', text, sessionId);
    });
    this.acpConnection.on('messageChunk', (text: string, sessionId: string) => {
      this.forwardMessageChunk(text, sessionId);
    });
    this.acpConnection.on('thoughtChunk', (text: string, sessionId: string) => {
      this.emitTyped('thoughtChunk', text, sessionId);
    });
    this.acpConnection.on('toolCall', (title: string, status: string, sessionId: string) => {
      this.forwardToolCall(title, status, sessionId);
    });
    this.acpConnection.on('plan', (plan: string, sessionId: string) => {
      this.emitTyped('plan', plan, sessionId);
    });
    this.acpConnection.on('sessionUpdate', (update: AcpSessionUpdateParams) => {
      this.emitTyped('sessionUpdate', update);
    });
    this.acpConnection.on('permissionRequest', (params: AcpPermissionRequestParams, resolve: (response: AcpPermissionResponse) => void) => {
      this.emitTyped('permissionRequest', params, resolve);
    });
    this.acpConnection.on('fileRead', (params: AcpFileReadParams, resolve: (response: AcpFileReadResponse) => void) => {
      this.emitTyped('fileRead', params, resolve);
    });
    this.acpConnection.on('fileWrite', (params: AcpFileWriteParams, resolve: (response: AcpFileWriteResponse) => void) => {
      this.emitTyped('fileWrite', params, resolve);
    });
    this.acpConnection.on('promptComplete', (sessionId: string) => {
      this.emitTyped('promptComplete', sessionId);
    });
    this.acpConnection.on('error', (err: Error) => {
      this.emitTyped('error', err);
    });
    this.acpConnection.on('exit', (code: number | null, signal: string | null) => {
      this.emitTyped('exit', code, signal);
    });
    this.acpConnection.on('log', (msg: string) => {
      this.emitTyped('log', msg);
    });
  }

  /**
   * DirectConnection 이벤트를 통합 클라이언트로 전파합니다.
   */
  private setupDirectEventForwarding(): void {
    if (!this.directConnection) return;

    // direct 모드에서 하위 프로세스의 stateChange는 포워딩하지 않음.
    // 논리적 연결 상태(directState)를 직접 관리하여 상태 불일치 방지.
    // (프로세스가 턴 단위로 종료되더라도 SDK 레벨에서는 세션이 유지됨)
    this.directConnection.on('messageChunk', (text: string, sessionId: string) => {
      this.forwardMessageChunk(text, sessionId);
    });
    this.directConnection.on('toolCall', (title: string, status: string, sessionId: string) => {
      this.forwardToolCall(title, status, sessionId);
    });
    this.directConnection.on('promptComplete', (sessionId: string) => {
      this.emitTyped('promptComplete', sessionId);
    });
    this.directConnection.on('error', (err: Error) => {
      // SDK 소비자가 error 리스너를 등록하지 않은 경우 Unhandled error crash 방지
      if (this.listenerCount('error') > 0) {
        this.emitTyped('error', err);
      }
    });
    this.directConnection.on('exit', (code: number | null, signal: string | null) => {
      this.emitTyped('exit', code, signal);
    });
    this.directConnection.on('log', (msg: string) => {
      this.emitTyped('log', msg);
    });
  }

  private async cleanupFailedAcpConnection(): Promise<void> {
    if (!this.acpConnection) {
      return;
    }

    try {
      await this.acpConnection.disconnect();
    } catch {
    }

    this.acpConnection.removeAllListeners();
    this.acpConnection = null;
    this.activeCli = null;
    this.sessionId = null;
    this.sessionCwd = null;
  }

  /**
   * 연결 실패 시 인증 필요 여부를 판별해 사용자가 이해하기 쉬운 에러로 변환합니다.
   */
  private buildConnectionError(cli: CliType, error: unknown, recentLogs: string[]): Error {
    const backend = getBackendConfig(cli);
    if (backend.authRequired && this.isAuthenticationError(error, recentLogs)) {
      return new Error(
        `[${cli}] 인증이 필요하거나 인증이 만료되었습니다. 먼저 해당 CLI에서 로그인/인증을 완료한 뒤 다시 시도해주세요.`,
      );
    }

    if (error instanceof Error) {
      return error;
    }

    // ACP SDK의 JSON-RPC ErrorResponse는 plain object { code, message, data? }로 reject됨
    if (typeof error === 'object' && error !== null) {
      const obj = error as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        const code = typeof obj.code === 'number' ? ` (code: ${obj.code})` : '';
        const data = obj.data ? ` — ${JSON.stringify(obj.data)}` : '';
        return new Error(`${obj.message}${code}${data}`);
      }
      // message 필드가 없는 plain object도 JSON으로 직렬화
      return new Error(JSON.stringify(error));
    }

    return new Error(String(error));
  }

  /**
   * 예외/로그 패턴 기반으로 인증 관련 실패를 판별합니다.
   */
  private isAuthenticationError(error: unknown, recentLogs: string[]): boolean {
    const authPatterns = [
      /auth_required/i,
      /authentication required/i,
      /not authenticated/i,
      /please login/i,
      /please log in/i,
      /sign in/i,
      /reauth/i,
      /unauthorized/i,
      /invalid api key/i,
    ];

    if (this.matchAnyPattern(this.extractErrorText(error), authPatterns)) {
      return true;
    }

    return recentLogs.some((log) => this.matchAnyPattern(log, authPatterns));
  }

  /**
   * 에러 객체에서 메시지 분석용 텍스트를 추출합니다.
   */
  private extractErrorText(error: unknown): string {
    if (error instanceof Error) {
      const code = (error as { code?: unknown }).code;
      if (code === -32000) {
        return `auth_required ${error.message}`;
      }
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return String(error);
  }

  /**
   * 문자열이 패턴 목록 중 하나와 일치하는지 검사합니다.
   */
  private matchAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
  }
}
