/**
 * infra-keybind/store.ts — keybindings.json 읽기
 *
 * 우선순위:
 *   1. extensions/keybindings.json — 사용자 커스텀 오버라이드 (.gitignore)
 *   2. extensions/keybindings.default.json — 기본 매핑 (git 추적)
 *   3. 둘 다 없으면 빈 객체 (코드 내 defaultKey 사용)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** keybindings.json 전체 타입: { extensionName: { actionName: keyCombo } } */
export type KeybindingsConfig = Record<string, Record<string, string>>;

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KEYBINDINGS_PATH = path.resolve(EXT_DIR, "..", "keybindings.json");
const KEYBINDINGS_DEFAULT_PATH = path.resolve(EXT_DIR, "..", "keybindings.default.json");

/** keybindings.json 읽기 (사용자 오버라이드 우선, 없으면 default fallback) */
export function loadKeybindings(): KeybindingsConfig {
  return readJsonFile(KEYBINDINGS_PATH)
    ?? readJsonFile(KEYBINDINGS_DEFAULT_PATH)
    ?? {};
}

/** 특정 확장/액션의 오버라이드 키를 반환 (없으면 undefined) */
export function getOverrideKey(extension: string, action: string): string | undefined {
  const config = loadKeybindings();
  const extConfig = config[extension];
  if (!extConfig || typeof extConfig !== "object") return undefined;
  const key = extConfig[action];
  return typeof key === "string" ? key : undefined;
}

/** JSON 파일을 파싱하여 반환 (없거나 파싱 실패 시 null) */
function readJsonFile(filePath: string): KeybindingsConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null) return null;
    return raw as KeybindingsConfig;
  } catch {
    return null;
  }
}
