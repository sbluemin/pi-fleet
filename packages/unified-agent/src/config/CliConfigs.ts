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

/** Codex ACP 기본 인라인 설정 인자 */
const CODEX_DEFAULT_CONFIG_OVERRIDES = ['service_tier="fast"'];

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
    npxPackage: '@zed-industries/codex-acp@0.11.1',
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

  // npx 브릿지 패키지를 사용하는 경우 (Claude, Codex ACP)
  if (backend.npxPackage) {
    const cleanEnv = cleanEnvironment(process.env, options.env);
    const npxPath = resolveNpxPath(cleanEnv);
    const npxArgs = buildNpxArgs(backend.npxPackage);
    const args = cli === 'codex'
      ? [...npxArgs, ...buildConfigArgs(CODEX_DEFAULT_CONFIG_OVERRIDES, options.configOverrides)]
      : npxArgs;

    return {
      command: npxPath,
      args,
      useNpx: true,
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
 * pre-spawn용 설정을 생성합니다.
 * createSpawnConfig와 동일하되, Gemini의 --model 인자를 포함하지 않습니다.
 * pre-spawn 후 connect → setModel 흐름에서 사용됩니다.
 *
 * @param cli - CLI 종류
 * @param options - 연결 옵션 (cwd 제외, 선택적)
 * @returns spawn 설정
 */
export function createPreSpawnConfig(
  cli: CliType,
  options?: Omit<ConnectionOptions, 'cwd'>,
): CliSpawnConfig {
  const opts = options ?? {};
  const backend = CLI_BACKENDS[cli];

  // npx 브릿지 패키지를 사용하는 경우 (Claude, Codex ACP) — createSpawnConfig와 동일
  if (backend.npxPackage) {
    const cleanEnv = cleanEnvironment(process.env, opts.env);
    const npxPath = resolveNpxPath(cleanEnv);
    const npxArgs = buildNpxArgs(backend.npxPackage);
    const args = cli === 'codex'
      ? [...npxArgs, ...buildConfigArgs(CODEX_DEFAULT_CONFIG_OVERRIDES, opts.configOverrides)]
      : npxArgs;

    return {
      command: npxPath,
      args,
      useNpx: true,
    };
  }

  // CLI를 직접 spawn하는 경우 (Gemini) — model, yoloMode 무시
  const command = opts.cliPath ?? backend.cliCommand;
  const args = backend.acpArgs ? [...backend.acpArgs] : [];

  return {
    command,
    args,
    useNpx: false,
  };
}

/**
 * 모든 백엔드 설정을 반환합니다.
 */
export function getAllBackendConfigs(): CliBackendConfig[] {
  return Object.values(CLI_BACKENDS);
}

/**
 * 기본 설정과 외부 오버라이드를 병합하여 `-c key=value` 인자 배열을 생성합니다.
 *
 * @param defaults - 기본 설정 값 배열 (e.g., ['service_tier="fast"'])
 * @param overrides - 외부에서 추가할 설정 값 배열 (선택)
 * @returns `-c` 플래그가 포함된 인자 배열
 */
function buildConfigArgs(defaults: string[], overrides?: string[]): string[] {
  const merged = [...defaults, ...(overrides ?? [])];
  return merged.flatMap((v) => ['-c', v]);
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
    const prefix = `mcp_servers.${server.name}`;
    args.push(`${prefix}.url="${server.url}"`);
    if (server.headers && server.headers.length > 0) {
      // Codex streamable_http은 http_headers (HashMap<String, String>) 필드 사용
      const headerEntries = server.headers
        .map((h) => `"${h.name}" = "${h.value}"`)
        .join(', ');
      args.push(`${prefix}.http_headers={${headerEntries}}`);
    }
    if (server.toolTimeout != null) {
      args.push(`${prefix}.tool_timeout_sec=${server.toolTimeout}`);
    }
  }
  return args;
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
