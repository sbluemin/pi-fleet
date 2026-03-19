/**
 * Direct 모드 출력 파서 레지스트리
 * CLI별 JSONL/출력 파서를 등록하고 조회합니다.
 */

import type { ParsedDirectEvent } from '../../types/direct.js';
import { parseCodexLine } from './CodexOutputParser.js';

/** 출력 파서 함수 타입 */
export type OutputParserFn = (line: string) => ParsedDirectEvent | null;

/** 출력 파서 레지스트리 */
export const OUTPUT_PARSERS: Record<string, OutputParserFn> = {
  'codex-jsonl': parseCodexLine,
};
