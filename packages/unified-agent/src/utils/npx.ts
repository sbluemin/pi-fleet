/**
 * npx 경로 해석 유틸리티
 */

import { execSync } from 'child_process';
import { isWindows } from './env.js';

/**
 * 시스템에서 npx 바이너리의 전체 경로를 해석합니다.
 *
 * @param env - 환경변수 (PATH 해석에 사용)
 * @returns npx 실행 경로
 * @throws npx를 찾을 수 없는 경우 에러
 */
export function resolveNpxPath(
  env?: Record<string, string | undefined>,
): string {
  const whichCmd = isWindows() ? 'where npx' : 'which npx';

  try {
    const result = execSync(whichCmd, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
      env: env as NodeJS.ProcessEnv,
    }).trim();

    // Windows의 `where`는 여러 줄을 반환할 수 있음 — 첫 번째 결과 사용
    return result.split('\n')[0].trim();
  } catch {
    // PATH가 정제된 환경에서는 기본 경로 시도
    if (isWindows()) {
      return 'npx.cmd';
    }
    return 'npx';
  }
}

/**
 * npx를 사용한 패키지 실행 인자를 생성합니다.
 *
 * scoped 패키지의 경우 `npx <pkg>@<version>` 형태가 일부 환경에서
 * 패키지 스펙을 실행 파일 이름으로 잘못 해석할 수 있으므로,
 * 항상 `npx --package=<pkg> <bin>` 형태로 고정합니다.
 *
 * @param packageName - 실행할 npm 패키지 (e.g., '@agentclientprotocol/claude-agent-acp@0.29.2')
 * @param preferOffline - npm 캐시 우선 사용 여부 (기본: false)
 * @returns npx 실행 인자 배열
 */
export function buildNpxArgs(
  packageName: string,
  preferOffline = false,
): string[] {
  const args = ['--yes'];
  if (preferOffline) {
    args.push('--prefer-offline');
  }
  args.push(`--package=${packageName}`);
  args.push(inferBinName(packageName));
  return args;
}

/**
 * npm 패키지 스펙에서 실행 바이너리 이름을 추론합니다.
 *
 * 예:
 * - @agentclientprotocol/claude-agent-acp@0.29.2 -> claude-agent-acp
 * - @zed-industries/codex-acp@0.11.1 -> codex-acp
 */
function inferBinName(packageName: string): string {
  const lastSegment = packageName.split('/').pop() ?? packageName;
  return lastSegment.replace(/@[^@/]+$/, '');
}
