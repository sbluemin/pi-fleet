/**
 * formation/scanner.ts — CWD 하위 1-depth 디렉토리 스캐너
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { getLogAPI } from "../../core/log/bridge.js";
import { DEFAULT_EXCLUDE_PATTERNS } from "../types.js";

export interface FleetCandidate {
  id: string;
  directory: string;
}

const LOG_SOURCE = "grand-fleet:formation";

/** CWD 하위 1-depth 디렉토리를 스캔하여 함대 후보 목록 반환 */
export function scanSubdirectories(
  cwd: string,
  excludePatterns: string[] = DEFAULT_EXCLUDE_PATTERNS,
): FleetCandidate[] {
  const log = getLogAPI();
  log.debug(LOG_SOURCE, `디렉토리 스캔 시작: ${cwd}`);

  const entries = fs.readdirSync(cwd, { withFileTypes: true });
  const candidates: FleetCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const name = entry.name;

    // 제외 패턴에 해당하면 스캔 대상에서 뺀다.
    if (isExcluded(name, excludePatterns)) {
      log.debug(LOG_SOURCE, `제외: ${name}`);
      continue;
    }

    const directory = path.resolve(cwd, name);

    // 읽을 수 없거나 비어 있는 디렉토리는 후보에서 제외한다.
    if (isEmpty(directory)) {
      continue;
    }

    candidates.push({
      id: name,
      directory,
    });
  }

  const sortedCandidates = candidates.sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const ids = sortedCandidates.map((candidate) => candidate.id).join(", ");
  log.debug(
    LOG_SOURCE,
    `함대 후보 ${sortedCandidates.length}개 발견: ${ids}`,
  );
  return sortedCandidates;
}

/** 제외 패턴에 해당하는 디렉토리명인지 확인 */
function isExcluded(name: string, patterns: string[]): boolean {
  // 숨김 디렉토리는 기본적으로 모두 제외한다.
  if (name.startsWith(".")) {
    return true;
  }

  return patterns.includes(name);
}

/** 디렉토리가 비어 있는지 확인 */
function isEmpty(directory: string): boolean {
  try {
    const entries = fs.readdirSync(directory);
    return entries.length === 0;
  } catch {
    // 읽기 실패는 스캔 대상에서 제외하는 보수적 동작으로 처리한다.
    return true;
  }
}
