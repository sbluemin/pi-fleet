/**
 * 연결 상태 및 이벤트 타입 정의
 * JSON-RPC 통신은 공식 ACP SDK에서 처리하므로 최소한의 타입만 유지
 */

/** 연결 상태 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'closed';

/** 클라이언트 정보 */
export interface ClientInfo {
  name: string;
  version: string;
}

/** 연결 이벤트 타입 */
export interface ConnectionEvents {
  /** 상태 변경 */
  stateChange: (state: ConnectionState) => void;
  /** 에러 발생 */
  error: (error: Error) => void;
  /** 프로세스 종료 */
  exit: (code: number | null, signal: string | null) => void;
  /** stderr 로그 */
  log: (message: string) => void;
}
