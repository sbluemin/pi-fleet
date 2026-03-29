/**
 * infra-experimental/store.ts — pi 글로벌 settings.json CRUD
 *
 * ~/.pi/agent/settings.json의 extensions 배열에
 * experimental/ 경로를 추가/삭제하는 저수준 함수.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExperimentalStatus } from "./types.js";

// ── 경로 계산 ──

/** pi 글로벌 settings.json 경로 */
export function getPiSettingsPath(): string {
  const settingsPath = path.resolve(os.homedir(), ".pi/agent/settings.json");
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`pi settings.json을 찾을 수 없습니다: ${settingsPath}`);
  }
  return fs.realpathSync(settingsPath);
}

/** experimental/ 디렉토리 절대경로 */
export function getExperimentalDir(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  // symlink 해석: extensions/ 자체가 symlink일 수 있음
  const realDir = fs.realpathSync(thisDir);
  return path.resolve(realDir, "../../experimental");
}

// ── pi settings.json 읽기/쓰기 ──

/** pi settings.json 전체 읽기 */
export function readPiSettings(): Record<string, unknown> {
  const rawText = fs.readFileSync(getPiSettingsPath(), "utf-8");
  const raw = JSON.parse(rawText);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("pi settings.json은 JSON 객체여야 합니다.");
  }
  return raw as Record<string, unknown>;
}

/** pi settings.json 전체 저장 (atomic write) */
export function writePiSettings(data: Record<string, unknown>): void {
  const settingsPath = getPiSettingsPath();
  const tempPath = `${settingsPath}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempPath, settingsPath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

// ── 경로 정규화 헬퍼 ──

/** ~ 치환 + realpathSync 정규화 (존재하는 경로만) */
function normalizePath(p: string): string {
  const expanded = p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : p;
  try {
    return fs.realpathSync(expanded);
  } catch {
    // 경로가 존재하지 않으면 확장만 적용
    return path.resolve(expanded);
  }
}

// ── experimental 상태 조회/변경 ──

/** extensions 배열에 experimental/ 경로가 있는지 확인 */
export function isExperimentalEnabled(): boolean {
  const settings = readPiSettings();
  const extensions = settings.extensions;
  if (!Array.isArray(extensions)) return false;

  const expDir = normalizePath(getExperimentalDir());
  return extensions.some(
    (entry) => typeof entry === "string" && normalizePath(entry) === expDir,
  );
}

/** extensions 배열에 experimental/ 경로 추가 (idempotent) */
export function enableExperimental(): void {
  const settings = readPiSettings();

  // extensions가 존재하지만 배열이 아닌 경우 에러
  if ("extensions" in settings && !Array.isArray(settings.extensions)) {
    throw new Error('pi settings.json의 "extensions"는 배열이어야 합니다.');
  }

  const extensions: unknown[] = Array.isArray(settings.extensions)
    ? [...settings.extensions]
    : [];

  const expDir = getExperimentalDir();
  const expNorm = normalizePath(expDir);

  // 이미 존재하면 추가하지 않음
  const exists = extensions.some(
    (entry) => typeof entry === "string" && normalizePath(entry) === expNorm,
  );
  if (!exists) {
    extensions.push(expDir);
  }

  settings.extensions = extensions;
  writePiSettings(settings);
}

/** extensions 배열에서 experimental/ 경로 제거 */
export function disableExperimental(): void {
  const settings = readPiSettings();

  // extensions가 존재하지만 배열이 아닌 경우 에러
  if ("extensions" in settings && !Array.isArray(settings.extensions)) {
    throw new Error('pi settings.json의 "extensions"는 배열이어야 합니다.');
  }
  if (!Array.isArray(settings.extensions)) return;

  const expNorm = normalizePath(getExperimentalDir());
  settings.extensions = settings.extensions.filter(
    (entry) => typeof entry !== "string" || normalizePath(entry) !== expNorm,
  );

  writePiSettings(settings);
}

/** experimental/ 하위 유효 확장 수 (index.ts가 있는 디렉토리) */
export function countExperimentalExtensions(): number {
  const expDir = getExperimentalDir();
  if (!fs.existsSync(expDir)) return 0;

  try {
    const entries = fs.readdirSync(expDir, { withFileTypes: true });
    return entries.filter(
      (e) => e.isDirectory() && fs.existsSync(path.join(expDir, e.name, "index.ts")),
    ).length;
  } catch {
    return 0;
  }
}

/** experimental/ 디렉토리 존재 여부 */
export function experimentalDirExists(): boolean {
  try {
    const expDir = getExperimentalDir();
    return fs.existsSync(expDir) && fs.statSync(expDir).isDirectory();
  } catch {
    return false;
  }
}

/** experimental 상태를 종합하여 반환 */
export function getStatus(): ExperimentalStatus {
  const enabled = isExperimentalEnabled();
  const dirExists = experimentalDirExists();
  return {
    enabled,
    extensionCount: countExperimentalExtensions(),
    mismatch: enabled && !dirExists,
  };
}
