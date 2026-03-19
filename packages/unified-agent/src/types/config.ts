/**
 * CLI 설정 및 구성 타입 정의
 */

/** 지원하는 CLI 종류 */
export type CliType = 'gemini' | 'claude' | 'codex';

/** 통신 프로토콜 */
export type ProtocolType = 'acp' | 'direct';

/** Direct 모드 설정 */
export interface DirectModeConfig {
  /** direct 모드 CLI 커맨드 (미지정 시 cliCommand 사용) */
  command?: string;
  /** 인자 빌더 타입 키 */
  argsBuilderType: string;
  /** 출력 파서 타입 키 */
  outputParserType: string;
}

/** 에이전트 모드 옵션 */
export interface AgentMode {
  /** 모드 ID (session/set_mode에 전달되는 값) */
  id: string;
  /** 표시 라벨 */
  label: string;
  /** 설명 (선택) */
  description?: string;
}

/** CLI 스폰 설정 */
export interface CliSpawnConfig {
  /** 실행 커맨드 (e.g., 'gemini', 'npx') */
  command: string;
  /** 커맨드 인자 */
  args: string[];
  /** npx를 사용하는지 여부 */
  useNpx: boolean;
}

/** CLI 백엔드 설정 */
export interface CliBackendConfig {
  /** CLI 식별자 */
  id: CliType;
  /** CLI 표시 이름 */
  name: string;
  /** CLI 커맨드 */
  cliCommand: string;
  /** 통신 프로토콜 */
  protocol: ProtocolType;
  /** 인증 필요 여부 */
  authRequired: boolean;
  /** ACP 모드 인자 (ACP 프로토콜인 경우) */
  acpArgs?: string[];
  /** npx 패키지 (브릿지인 경우) */
  npxPackage?: string;
  /** 사용 가능한 에이전트 모드 목록 (session/set_mode 지원 시) */
  modes?: AgentMode[];
  /** Direct 모드 설정 (지원하는 CLI만) */
  directConfig?: DirectModeConfig;
}

/** 연결 옵션 */
export interface ConnectionOptions {
  /** 작업 디렉토리 */
  cwd: string;
  /** 타임아웃 (ms) */
  timeout?: number;
  /** YOLO 모드 (자동 승인) */
  yoloMode?: boolean;
  /** 커스텀 환경변수 */
  env?: Record<string, string>;
  /** 커스텀 CLI 경로 */
  cliPath?: string;
  /** 클라이언트 정보 */
  clientInfo?: {
    name: string;
    version: string;
  };
  /** 모델 지정 */
  model?: string;
}

/** CLI 감지 결과 */
export interface CliDetectionResult {
  /** CLI 종류 */
  cli: CliType;
  /** CLI 경로 */
  path: string;
  /** 사용 가능 여부 */
  available: boolean;
  /** 버전 (감지 가능한 경우) */
  version?: string;
  /** 지원 프로토콜 목록 */
  protocols: ProtocolType[];
}

/** 통합 클라이언트 옵션 */
export interface UnifiedClientOptions extends ConnectionOptions {
  /** CLI 선택 (미지정 시 자동 감지) */
  cli?: CliType;
  /** 자동 권한 승인 */
  autoApprove?: boolean;
  /** 재개할 기존 세션 ID */
  sessionId?: string;
  /** Direct 모드 사용 여부 (ACP 우회) */
  direct?: boolean;
  /** Reasoning effort (direct 모드에서 사용) */
  effort?: string;
}
