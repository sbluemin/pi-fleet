/**
 * Direct 모드 전용 타입 정의
 * ACP 프로토콜을 우회하여 CLI를 직접 실행할 때 사용하는 타입들
 */

/** Direct 실행 옵션 */
export interface DirectExecOptions {
  /** 프롬프트 */
  prompt: string;
  /** 모델 이름 */
  model?: string;
  /** Reasoning effort */
  effort?: string;
  /** 작업 디렉토리 */
  cwd: string;
  /** 자동 승인 모드 */
  yolo: boolean;
  /** 재개할 세션 ID */
  sessionId?: string;
}

/** Direct 실행 결과 */
export interface DirectExecResult {
  /** 전체 응답 텍스트 */
  response: string;
  /** 세션 ID (thread ID) */
  sessionId: string | null;
  /** 프로세스 종료 코드 */
  exitCode: number;
}

/** Codex exec JSONL 이벤트 아이템 */
export interface CodexJsonlItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

/** Codex exec JSONL 이벤트 */
export interface CodexJsonlEvent {
  type: string;
  thread_id?: string;
  item?: CodexJsonlItem;
  usage?: { input_tokens: number; output_tokens: number };
}

/** 파싱된 Direct 이벤트 타입 */
export type ParsedDirectEventType =
  | 'messageChunk'
  | 'toolCall'
  | 'threadStarted'
  | 'turnCompleted';

/** 파싱된 Direct 이벤트 */
export interface ParsedDirectEvent {
  /** 이벤트 타입 */
  type: ParsedDirectEventType;
  /** 메시지 텍스트 (messageChunk) */
  text?: string;
  /** 도구 호출 제목 (toolCall) */
  title?: string;
  /** 스레드/세션 ID (threadStarted) */
  threadId?: string;
}

/** Direct 인자 빌드 옵션 */
export interface DirectArgsBuildOptions {
  /** 프롬프트 */
  prompt: string;
  /** 모델 이름 */
  model?: string;
  /** Reasoning effort */
  effort?: string;
  /** 작업 디렉토리 */
  cwd: string;
  /** 자동 승인 모드 */
  yolo: boolean;
  /** 재개할 세션 ID */
  sessionId?: string;
}
