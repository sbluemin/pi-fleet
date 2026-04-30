import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { LogCategoryMeta, LogEntry, LogLevel, LogSettings } from "./types.js";
import { DEFAULT_LOG_CATEGORY, LOG_LEVEL_PRIORITY } from "./types.js";

export interface CoreLogSettingsPort {
  load<T = Record<string, unknown>>(sectionKey: string): T;
  save(sectionKey: string, data: unknown): void;
}

const SECTION_KEY = "core-log";
const LEGACY_SECTION_KEY = "core-debug-log";
const FLEET_DATA_DIR = path.join(os.homedir(), ".pi", "fleet");
const LOGS_DIR = path.join(FLEET_DATA_DIR, "logs");
const RING_BUFFER_SIZE = 100;
const DEFAULT_SETTINGS: Required<LogSettings> = {
  enabled: false,
  fileLog: true,
  footerDisplay: true,
  minLevel: "debug",
  disabledCategories: [],
};
const ringBuffer: LogEntry[] = [];
const categoryRegistry = new Map<string, LogCategoryMeta>();

let settingsPort: CoreLogSettingsPort | null = null;
let migrated = false;

registerCategory({
  id: DEFAULT_LOG_CATEGORY,
  label: "General",
  description: "기본 로그 카테고리",
});

export function setCoreLogSettingsPort(port: CoreLogSettingsPort): void {
  settingsPort = port;
}

export function loadSettings(): Required<LogSettings> {
  try {
    ensureMigrated();
    const raw = getSettingsPort().load<LogSettings>(SECTION_KEY);
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Partial<LogSettings>): void {
  ensureMigrated();
  const current = loadSettings();
  const merged = { ...current, ...settings };
  getSettingsPort().save(SECTION_KEY, merged);
}

export function registerCategory(meta: LogCategoryMeta): void {
  categoryRegistry.set(meta.id, meta);
}

export function getRegisteredCategories(): LogCategoryMeta[] {
  return Array.from(categoryRegistry.values());
}

export function isCategoryRegistered(id: string): boolean {
  return categoryRegistry.has(id);
}

export function appendLog(entry: LogEntry, settings: Required<LogSettings>): void {
  if (!isCategoryRegistered(entry.category)) return;
  if (settings.disabledCategories.includes(entry.category)) return;

  if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[settings.minLevel]) {
    return;
  }

  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }

  if (settings.fileLog) {
    writeToFile(entry);
  }
}

export function getRecentLogs(count: number = 10): LogEntry[] {
  const start = Math.max(0, ringBuffer.length - count);
  return ringBuffer.slice(start);
}

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

export function clearLogs(): void {
  ringBuffer.length = 0;
}

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

function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  try {
    const api = getSettingsPort();
    const newData = api.load<LogSettings>(SECTION_KEY);
    if (newData && Object.keys(newData).length > 0) return;

    const legacyData = api.load<LogSettings>(LEGACY_SECTION_KEY);
    if (legacyData && Object.keys(legacyData).length > 0) {
      api.save(SECTION_KEY, legacyData);
      api.save(LEGACY_SECTION_KEY, {});
    }
  } catch {
    // 마이그레이션 실패 시 무시
  }
}

function writeToFile(entry: LogEntry): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const date = entry.timestamp.slice(0, 10);
    const category = sanitizeCategory(entry.category);
    const filePath = path.join(LOGS_DIR, `${category}-${date}.log`);
    const time = entry.timestamp.slice(11, 23);
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

function getSettingsPort(): CoreLogSettingsPort {
  if (!settingsPort) throw new Error("core-settings API not available");
  return settingsPort;
}
