import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

export type KeybindingsConfig = Record<string, Record<string, string>>;

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KEYBINDINGS_PATH = path.resolve(EXT_DIR, "keybindings.json");
const KEYBINDINGS_DEFAULT_PATH = path.resolve(EXT_DIR, "keybindings.default.json");

function loadKeybindings(): KeybindingsConfig {
  return readKeybindingsFile(KEYBINDINGS_PATH)
    ?? readKeybindingsFile(KEYBINDINGS_DEFAULT_PATH)
    ?? {};
}

export function getOverrideKey(extension: string, action: string): string | undefined {
  const extConfig = loadKeybindings()[extension];
  if (!extConfig || typeof extConfig !== "object") return undefined;
  const key = extConfig[action];
  return typeof key === "string" ? key : undefined;
}

function readKeybindingsFile(filePath: string): KeybindingsConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null) return null;
    return raw as KeybindingsConfig;
  } catch {
    return null;
  }
}
