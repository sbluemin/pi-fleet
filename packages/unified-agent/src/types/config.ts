/**
 * CLI 설정 및 구성 타입 정의
 */

/** 지원하는 CLI 종류 */
export type CliType = 'gemini' | 'claude' | 'codex';

/** 통신 프로토콜 */
export type ProtocolType = 'acp' | 'codex-app-server';

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
  /** app-server 시작 인자 (Codex native spawn용) */
  appServerArgs?: string[];
  /** 사용 가능한 에이전트 모드 목록 (session/set_mode 지원 시) */
  modes?: AgentMode[];
}

/** 통합 MCP 서버 설정 (백엔드 무관 공통 타입) */
export interface McpServerConfig {
  /** 전송 방식 */
  type: 'http';
  /** MCP 서버 이름 */
  name: string;
  /** MCP 서버 URL */
  url: string;
  /** HTTP 헤더 (인증 등) */
  headers?: { name: string; value: string }[];
  /** MCP tool call 타임아웃 (초).
   *  Codex: `-c mcp_servers.{name}.tool_timeout_sec` 으로 전달.
   *  Claude/Gemini: 현재 ACP에서 미지원, 향후 `_meta` 확장 예정. */
  toolTimeout?: number;
}

/** 연결 옵션 */
export interface ConnectionOptions {
  /** 작업 디렉토리 */
  cwd: string;
  /** 타임아웃 (ms) — requestTimeout/initTimeout에 매핑 */
  timeout?: number;
  /** 프롬프트 유휴 타임아웃 (ms).
   *  스트리밍 활동 없이 이 시간이 경과하면 프롬프트 타임아웃.
   *  미지정 시 SDK 기본값(120초) 사용. 0 이하이면 비활성화. */
  promptIdleTimeout?: number;
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
  /** CLI 설정 오버라이드 — Codex `-c key=value` 형태로 전달 */
  configOverrides?: string[];
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
  /** 세션 초기 시스템 지침.
   * Claude에서는 native system prompt에 append되며,
   * Codex에서는 app-server의 developerInstructions로 전달될 예정이고,
   * Gemini에서는 세션의 최초 user turn 앞에 선행 text block으로 주입됨
   * (best-effort initial session instructions). */
  systemPrompt?: string;
  /** 에이전트에 연결할 MCP 서버 목록 (선택) */
  mcpServers?: McpServerConfig[];
}
