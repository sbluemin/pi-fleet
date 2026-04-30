/**
 * core-settings/store.ts — settings.json CRUD
 *
 * 패키지-local settings.json 파일을 읽고 쓰는 저수준 함수.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Fleet 전역 데이터 디렉토리: ~/.pi/fleet/
// os.homedir() 직접 사용으로 PI_CODING_AGENT_DIR 환경변수 override와 무관하게 경로를 고정한다.
const FLEET_DATA_DIR = path.join(os.homedir(), ".pi", "fleet");
const GLOBAL_SETTINGS_PATH = path.join(FLEET_DATA_DIR, "settings.json");

/** 특정 섹션 로드 */
export function loadSection<T = Record<string, unknown>>(key: string): T {
  const global = readGlobalJson();
  const section = global[key];
  if (typeof section !== "object" || section === null) return {} as T;
  return section as T;
}

/** 특정 섹션 저장 (기존 데이터와 병합) */
export function saveSection(key: string, data: unknown): void {
  const global = readGlobalJson();
  global[key] = data;
  writeGlobalJson(global);
}

/** 전체 JSON 객체 읽기 */
function readGlobalJson(): Record<string, unknown> {
  try {
    if (!fs.existsSync(GLOBAL_SETTINGS_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_PATH, "utf-8"));
    if (typeof raw !== "object" || raw === null) return {};
    return raw as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 전체 JSON 객체 쓰기 */
function writeGlobalJson(data: Record<string, unknown>): void {
  // 디렉토리가 없으면 생성 (~/.pi/fleet/ 첫 실행 시)
  if (!fs.existsSync(FLEET_DATA_DIR)) {
    fs.mkdirSync(FLEET_DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(GLOBAL_SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
}
