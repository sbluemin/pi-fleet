/**
 * Direct 모드 인자 빌더 레지스트리
 * CLI별 direct 실행 인자를 빌드하는 함수를 등록하고 조회합니다.
 */

import type { DirectArgsBuildOptions } from '../types/direct.js';

/**
 * Codex exec 인자를 빌드합니다.
 * 세션 재개 시: codex exec resume <sessionId> --json [opts] <prompt>
 * 신규 실행 시: codex exec --json [opts] <prompt>
 *
 * @param options - 빌드 옵션
 * @returns 인자 배열
 */
export function buildCodexDirectArgs(options: DirectArgsBuildOptions): string[] {
  const args: string[] = ['exec'];

  if (options.sessionId) {
    args.push('resume', options.sessionId);
  }

  args.push('--json');
  args.push('--skip-git-repo-check');

  // /fast 모드 기본 적용
  args.push('-c', 'service_tier="fast"');

  if (options.model) args.push('-m', options.model);
  if (options.effort) args.push('-c', `model_reasoning_effort="${options.effort}"`);
  if (!options.sessionId && options.cwd) args.push('-C', options.cwd);
  if (options.yolo) args.push('--dangerously-bypass-approvals-and-sandbox');

  args.push(options.prompt);
  return args;
}

/** 인자 빌더 함수 타입 */
export type DirectArgsBuilderFn = (options: DirectArgsBuildOptions) => string[];

/** 인자 빌더 레지스트리 */
export const DIRECT_ARGS_BUILDERS: Record<string, DirectArgsBuilderFn> = {
  'codex-exec': buildCodexDirectArgs,
};
