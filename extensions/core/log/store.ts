/**
 * core-log/store.ts — 파일 로그 + 설정 관리
 *
 * - 설정: core-settings API를 통해 ~/.pi/fleet/settings.json의 "core-log" 섹션에서 읽고 쓴다.
 *   (하위 호환: 기존 "core-debug-log" 섹션이 존재하면 "core-log"로 마이그레이션)
 * - 파일 로그: ~/.pi/fleet/logs/ 디렉토리에 날짜별 로그 파일 기록.
 * - 인메모리 링 버퍼: Footer 표시용 최근 로그 보관.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import type { LogCategoryMeta, LogEntry, LogLevel, LogSettings } from "./types.js";
import { DEFAULT_LOG_CATEGORY, LOG_LEVEL_PRIORITY } from "./types.js";
import { getSettingsAPI } from "../settings/bridge.js";
import type { CoreSettingsAPI } from "../settings/types.js";

// ── 상수 ──

const SECTION_KEY = "core-log";
const LEGACY_SECTION_KEY = "core-debug-log";
const FLEET_DATA_DIR = path.join(os.homedir(), ".pi", "fleet");
const LOGS_DIR = path.join(FLEET_DATA_DIR, "logs");
const RING_BUFFER_SIZE = 100;

/** 기본 설정 */
const DEFAULT_SETTINGS: Required<LogSettings> = {
  enabled: false,
  fileLog: true,
  footerDisplay: true,
  minLevel: "debug",
  disabledCategories: [],
};

// ── 인메모리 링 버퍼 ──

const ringBuffer: LogEntry[] = [];

// ── 카테고리 레지스트리 ──

const categoryRegistry = new Map<string, LogCategoryMeta>();

registerCategory({
  id: DEFAULT_LOG_CATEGORY,
  label: "General",
  description: "기본 로그 카테고리",
});

// ── 설정 마이그레이션 ──

let migrated = false;

/** 기존 "core-debug-log" 섹션을 "core-log"로 마이그레이션 (1회만) */
function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  try {
    const api = getAPI();
    const newData = api.load<LogSettings>(SECTION_KEY);
    // 새 키에 데이터가 이미 있으면 마이그레이션 불필요
    if (newData && Object.keys(newData).length > 0) return;

    const legacyData = api.load<LogSettings>(LEGACY_SECTION_KEY);
    if (legacyData && Object.keys(legacyData).length > 0) {
      api.save(SECTION_KEY, legacyData);
      // 레거시 키 제거 — 빈 객체로 덮어쓰기
      api.save(LEGACY_SECTION_KEY, {});
    }
  } catch {
    // 마이그레이션 실패 시 무시 — 기본값으로 동작
  }
}

// ── 설정 CRUD ──

/** 설정 로드 */
export function loadSettings(): Required<LogSettings> {
  try {
    ensureMigrated();
    const raw = getAPI().load<LogSettings>(SECTION_KEY);
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 설정 저장 */
export function saveSettings(settings: Partial<LogSettings>): void {
  ensureMigrated();
  const current = loadSettings();
  const merged = { ...current, ...settings };
  getAPI().save(SECTION_KEY, merged);
}

/** 카테고리 등록 */
export function registerCategory(meta: LogCategoryMeta): void {
  categoryRegistry.set(meta.id, meta);
}

/** 등록된 모든 카테고리 조회 */
export function getRegisteredCategories(): LogCategoryMeta[] {
  return Array.from(categoryRegistry.values());
}

/** 카테고리 등록 여부 확인 */
export function isCategoryRegistered(id: string): boolean {
  return categoryRegistry.has(id);
}

// ── 로그 기록 ──

/** 로그 항목 추가 (인메모리 + 파일) */
export function appendLog(entry: LogEntry, settings: Required<LogSettings>): void {
  if (!isCategoryRegistered(entry.category)) return;
  if (settings.disabledCategories.includes(entry.category)) return;

  // 최소 레벨 필터링
  if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[settings.minLevel]) {
    return;
  }

  // 인메모리 링 버퍼에 추가
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }

  // 파일 로그
  if (settings.fileLog) {
    writeToFile(entry);
  }
}

/** 최근 로그 항목 반환 (필터 없이) */
export function getRecentLogs(count: number = 10): LogEntry[] {
  const start = Math.max(0, ringBuffer.length - count);
  return ringBuffer.slice(start);
}

/** 현재 minLevel 기준으로 가장 최근 로그 1개 반환 (없으면 null) */
export function getLatestVisibleLog(minLevel: LogLevel): LogEntry | null {
  const threshold = LOG_LEVEL_PRIORITY[minLevel];
  for (let i = ringBuffer.length - 1; i >= 0; i--) {
    if (
      !ringBuffer[i]!.hideFromFooter &&
      LOG_LEVEL_PRIORITY[ringBuffer[i]!.level] >= threshold
    ) {
      return ringBuffer[i]!;
    }
  }
  return null;
}

/** 현재 minLevel 기준으로 최근 로그 최대 count개 반환 (최신이 마지막) */
export function getLatestVisibleLogs(minLevel: LogLevel, count: number): LogEntry[] {
  const threshold = LOG_LEVEL_PRIORITY[minLevel];
  const result: LogEntry[] = [];
  for (let i = ringBuffer.length - 1; i >= 0 && result.length < count; i--) {
    if (
      !ringBuffer[i]!.hideFromFooter &&
      LOG_LEVEL_PRIORITY[ringBuffer[i]!.level] >= threshold
    ) {
      result.push(ringBuffer[i]!);
    }
  }
  return result.reverse();
}

/** 링 버퍼 초기화 */
export function clearLogs(): void {
  ringBuffer.length = 0;
}

/** 파일 로그 전체 삭제 */
export function clearFileLogs(): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) return;
    const files = fs.readdirSync(LOGS_DIR);
    for (const file of files) {
      if (file.endsWith(".log")) {
        fs.unlinkSync(path.join(LOGS_DIR, file));
      }
    }
  } catch {
    // 파일 삭제 실패 시 무시
  }
}

// ── 파일 로그 ──

/** 로그 파일에 한 줄 추가 */
function writeToFile(entry: LogEntry): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    const category = sanitizeCategory(entry.category);
    const filePath = path.join(LOGS_DIR, `${category}-${date}.log`);
    const time = entry.timestamp.slice(11, 23); // HH:mm:ss.SSS
    const line = `[${time}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.source}] ${entry.message}\n`;
    const flags =
      fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_APPEND |
      fs.constants.O_NOFOLLOW;
    const fd = fs.openSync(filePath, flags, 0o600);
    try {
      fs.writeSync(fd, line);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // 파일 쓰기 실패 시 무시 — 로거가 크래시를 유발해서는 안 된다
  }
}

// ── 내부 헬퍼 ──

/** category를 안전한 단일 파일명 세그먼트로 정규화한다 */
function sanitizeCategory(raw: string): string {
  if (raw.length === 0 || raw.startsWith(".")) {
    return "general";
  }

  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  if (sanitized.length === 0 || sanitized.startsWith(".")) {
    return "general";
  }
  return sanitized;
}

function getAPI(): CoreSettingsAPI {
  const api = getSettingsAPI();
  if (!api) throw new Error("core-settings API not available");
  return api;
}
