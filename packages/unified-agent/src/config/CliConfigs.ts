/**
 * CLI별 설정 정의
 * 각 CLI의 spawn 파라미터와 백엔드 구성을 관리합니다.
 */

import type { McpServer } from '@agentclientprotocol/sdk';
import type {
  CliBackendConfig,
  CliSpawnConfig,
  CliType,
  ConnectionOptions,
  McpServerConfig,
} from '../types/config.js';
import { resolveNpxPath, buildNpxArgs } from '../utils/npx.js';
import { cleanEnvironment } from '../utils/env.js';

/** ACP 기본 인자 */
const DEFAULT_ACP_ARGS = ['--acp'];

/** CLI 백엔드 설정 전체 맵 */
export const CLI_BACKENDS: Record<CliType, CliBackendConfig> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini CLI',
    cliCommand: 'gemini',
    protocol: 'acp',
    authRequired: true,
    acpArgs: DEFAULT_ACP_ARGS,
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'autoEdit', label: 'Auto-Accept Edits' },
      { id: 'yolo', label: 'YOLO' },
    ],
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude Code',
    cliCommand: 'claude',
    protocol: 'acp',
    authRequired: true,
    npxPackage: '@agentclientprotocol/claude-agent-acp@0.29.2',
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'plan', label: 'Plan' },
      { id: 'bypassPermissions', label: 'YOLO' },
    ],
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    cliCommand: 'codex',
    protocol: 'acp',
    authRequired: true,
    npxPackage: '@zed-industries/codex-acp@0.12.0',
    appServerArgs: ['app-server', '--listen', 'stdio://'],
    modes: [
      { id: 'default', label: 'Plan' },
      { id: 'autoEdit', label: 'Auto Edit' },
      { id: 'yolo', label: 'Full Auto' },
    ],
  },
};

/**
 * CLI별 spawn 설정을 생성합니다.
 *
 * @param cli - CLI 종류
 * @param options - 연결 옵션
 * @returns spawn 설정
 */
export function createSpawnConfig(
  cli: CliType,
  options: ConnectionOptions,
): CliSpawnConfig {
  const backend = CLI_BACKENDS[cli];

  // npx 브릿지 패키지를 사용하는 경우 (Claude ACP, Codex ACP bridge)
  if (backend.npxPackage) {
    const cleanEnv = cleanEnvironment(process.env, options.env);
    const npxPath = resolveNpxPath(cleanEnv);
    const npxArgs = buildNpxArgs(backend.npxPackage);
    const args = cli === 'codex' && backend.protocol === 'acp'
      ? [...npxArgs, ...buildConfigArgs(options.configOverrides)]
      : npxArgs;

    return {
      command: npxPath,
      args,
      useNpx: true,
    };
  }

  // Codex app-server native spawn
  if (backend.appServerArgs) {
    const command = options.cliPath ?? backend.cliCommand;
    return {
      command,
      args: [...backend.appServerArgs],
      useNpx: false,
    };
  }

  // CLI를 직접 spawn하는 경우 (Gemini)
  const command = options.cliPath ?? backend.cliCommand;
  const args = backend.acpArgs ? [...backend.acpArgs] : [];

  if (cli === 'gemini' && options.yoloMode) {
    // Gemini CLI 공식 문서 기준 YOLO는 command line approval mode로 켜는 것이 가장 명시적입니다.
    args.push('--approval-mode=yolo');
  }

  if (cli === 'gemini' && options.model) {
    // Gemini ACP는 세션 시작 후 모델 변경 지원이 제한적이어서 spawn 시점에 모델을 넘깁니다.
    args.push('--model', options.model);
  }

  return {
    command,
    args,
    useNpx: false,
  };
}

/**
 * CLI의 백엔드 설정을 가져옵니다.
 *
 * @param cli - CLI 종류
 * @returns 백엔드 설정
 */
export function getBackendConfig(cli: CliType): CliBackendConfig {
  return CLI_BACKENDS[cli];
}

/**
 * CLI별 YOLO 모드 ID를 반환합니다.
 *
 * @param cli - CLI 종류
 * @returns ACP session/set_mode에 전달할 모드 ID
 */
export function getYoloModeId(cli: CliType): string {
  switch (cli) {
    case 'claude':
      return 'bypassPermissions';
    case 'gemini':
    case 'codex':
      return 'yolo';
  }
}

/**
 * 모든 백엔드 설정을 반환합니다.
 */
export function getAllBackendConfigs(): CliBackendConfig[] {
  return Object.values(CLI_BACKENDS);
}

/**
 * Codex 계열 `-c key=value` 설정을 CLI 인자 배열로 변환합니다.
 *
 * @param overrides - Codex 설정 오버라이드 배열
 * @returns `-c key=value` 형태의 인자 배열
 */
function buildConfigArgs(overrides?: string[]): string[] {
  return (overrides ?? []).flatMap((value) => ['-c', value]);
}

// ─── MCP 서버 설정 변환 ──────────────────────────────

/**
 * McpServerConfig 배열을 Codex용 `-c` 인자 배열로 변환합니다.
 * Codex는 ACP mcpServers 대신 config.toml 오버라이드로 MCP 서버를 등록하여
 * tool_timeout_sec를 제어합니다.
 *
 * @param servers - 통합 MCP 서버 설정 배열
 * @returns `-c key=value` 형태의 문자열 배열 (buildConfigArgs에 전달용)
 */
export function mcpServerConfigsToCodexArgs(servers: McpServerConfig[]): string[] {
  const args: string[] = [];
  for (const server of servers) {
    const serverName = toTomlBareKeySegment(server.name, 'MCP 서버 이름');
    args.push(`mcp_servers.${serverName}.url="${toTomlBasicString(server.url)}"`);
    if (server.headers && server.headers.length > 0) {
      // Codex streamable_http은 http_headers (HashMap<String, String>) 필드 사용
      const headerEntries = server.headers
        .map((h) => `"${toTomlBasicString(h.name)}" = "${toTomlBasicString(h.value)}"`)
        .join(', ');
      args.push(`mcp_servers.${serverName}.http_headers={${headerEntries}}`);
    }
    if (server.toolTimeout != null) {
      args.push(`mcp_servers.${serverName}.tool_timeout_sec=${toPositiveFiniteNumber(
        server.toolTimeout,
        `${server.name}.toolTimeout`,
      )}`);
    }
  }
  return args;
}

/**
 * TOML dotted key의 bare key segment로 안전한 값인지 확인합니다.
 *
 * @param value - 검사할 key segment
 * @param label - 오류 메시지에 표시할 라벨
 * @returns 검증된 key segment
 */
function toTomlBareKeySegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label}은 TOML bare key로 안전한 영문자/숫자/하이픈/언더스코어만 허용합니다: ${value}`);
  }
  return value;
}

/**
 * TOML basic string 내부에서 안전하도록 문자열을 escape합니다.
 *
 * @param value - escape할 문자열
 * @returns TOML basic string 내부 값
 */
function toTomlBasicString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\u0000-\u001F\u007F]/g, (char) => {
      switch (char) {
        case '\b':
          return '\\b';
        case '\t':
          return '\\t';
        case '\n':
          return '\\n';
        case '\f':
          return '\\f';
        case '\r':
          return '\\r';
        default:
          return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
      }
    });
}

/**
 * Codex TOML 숫자 설정에 넣을 양의 유한 숫자를 검증합니다.
 *
 * @param value - 검사할 숫자
 * @param label - 오류 메시지에 표시할 라벨
 * @returns 문자열화된 숫자
 */
function toPositiveFiniteNumber(value: number, label: string): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}은 0보다 큰 유한 숫자여야 합니다.`);
  }
  return String(value);
}

/**
 * McpServerConfig 배열을 ACP McpServer 배열로 변환합니다.
 * Claude/Gemini는 ACP session/new에 mcpServers로 전달합니다.
 *
 * @param servers - 통합 MCP 서버 설정 배열
 * @returns ACP SDK McpServer 배열
 */
export function mcpServerConfigsToAcp(servers: McpServerConfig[]): McpServer[] {
  return servers.map((server) => ({
    type: server.type,
    name: server.name,
    url: server.url,
    headers: server.headers ?? [],
  })) as McpServer[];
}
