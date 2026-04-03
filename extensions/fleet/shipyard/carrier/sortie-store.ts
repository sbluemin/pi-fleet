/**
 * sortie-store.ts — Sortie 비활성 carrier 영속화
 *
 * .data/sortie-disabled.json 파일을 통해
 * sortie 비활성화 상태를 디스크에 저장/복원합니다.
 */

import * as path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** 영속화 파일명 */
const FILENAME = "sortie-disabled.json";

/**
 * 디스크에서 sortie 비활성 carrier ID 목록을 로드합니다.
 * 유효한 carrier ID만 필터링하여 반환합니다.
 * @param dataDir .data 디렉토리 경로
 * @param validIds 현재 등록된 carrier ID 집합 (유효성 필터용)
 */
export function loadSortieDisabled(dataDir: string, validIds: Set<string>): string[] {
  const filePath = path.join(dataDir, FILENAME);
  try {
    if (!existsSync(filePath)) return [];
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!Array.isArray(raw)) return [];
    // 문자열이면서 현재 등록된 carrier만 허용
    return raw.filter((id): id is string => typeof id === "string" && validIds.has(id));
  } catch {
    // 파일 손상·파싱 실패 시 빈 상태로 시작
    return [];
  }
}

/**
 * sortie 비활성 carrier ID 목록을 디스크에 저장합니다.
 * @param dataDir .data 디렉토리 경로
 * @param ids 비활성화된 carrier ID 배열
 */
export function saveSortieDisabled(dataDir: string, ids: string[]): void {
  const filePath = path.join(dataDir, FILENAME);
  try {
    writeFileSync(filePath, JSON.stringify(ids), "utf-8");
  } catch {
    // 영속화 실패 무시
  }
}
