/**
 * sortie-store.ts — Sortie 비활성 carrier 영속화
 *
 * states.json 파일을 통해
 * sortie 비활성화 상태를 디스크에 저장/복원합니다.
 */

import * as path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** states.json의 스키마 */
interface FleetStates {
  /** sortie 비활성 carrier ID 목록 */
  sortieDisabled?: string[];
}

/** 영속화 파일명 */
const FILENAME = "states.json";

/**
 * 디스크에서 sortie 비활성 carrier ID 목록을 로드합니다.
 * 유효한 carrier ID만 필터링하여 반환합니다.
 * @param dataDir .data 디렉토리 경로
 * @param validIds 현재 등록된 carrier ID 집합 (유효성 필터용)
 */
export function loadSortieDisabled(dataDir: string, validIds?: Set<string>): string[] {
  const filePath = path.join(dataDir, FILENAME);
  try {
    if (!existsSync(filePath)) return [];
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as FleetStates;
    const ids = raw?.sortieDisabled;
    if (!Array.isArray(ids)) return [];
    // 문자열만 허용, validIds가 주어지면 등록된 carrier만 필터링
    return ids.filter((id): id is string => typeof id === "string" && (!validIds || validIds.has(id)));
  } catch {
    // 파일 손상·파싱 실패 시 빈 상태로 시작
    return [];
  }
}

/**
 * sortie 비활성 carrier ID 목록을 디스크에 저장합니다.
 * 기존 states.json의 다른 키는 유지하며 sortieDisabled만 갱신합니다.
 * @param dataDir .data 디렉토리 경로
 * @param ids 비활성화된 carrier ID 배열
 */
export function saveSortieDisabled(dataDir: string, ids: string[]): void {
  const filePath = path.join(dataDir, FILENAME);
  try {
    // 기존 상태를 읽어 병합 (다른 키 보존)
    let existing: FleetStates = {};
    if (existsSync(filePath)) {
      try {
        existing = JSON.parse(readFileSync(filePath, "utf-8")) as FleetStates;
      } catch {
        existing = {};
      }
    }
    const updated: FleetStates = { ...existing, sortieDisabled: ids };
    writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    // 영속화 실패 무시
  }
}
