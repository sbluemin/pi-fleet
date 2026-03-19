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
 * @param packageName - 실행할 npm 패키지 (e.g., '@zed-industries/claude-agent-acp@0.18.0')
 * @param preferOffline - npm 캐시 우선 사용 여부 (기본: true)
 * @returns npx 실행 인자 배열
 */
export function buildNpxArgs(
  packageName: string,
  preferOffline = true,
): string[] {
  const args = ['--yes'];
  if (preferOffline) {
    args.push('--prefer-offline');
  }
  args.push(packageName);
  return args;
}
