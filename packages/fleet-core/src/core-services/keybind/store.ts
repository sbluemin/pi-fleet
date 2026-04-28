import * as fs from "node:fs";

export type KeybindingsConfig = Record<string, Record<string, string>>;

export function loadKeybindingsFromPaths(
  keybindingsPath: string,
  defaultKeybindingsPath: string,
): KeybindingsConfig {
  return readKeybindingsFile(keybindingsPath)
    ?? readKeybindingsFile(defaultKeybindingsPath)
    ?? {};
}

export function getOverrideKeyFromConfig(
  config: KeybindingsConfig,
  extension: string,
  action: string,
): string | undefined {
  const extConfig = config[extension];
  if (!extConfig || typeof extConfig !== "object") return undefined;
  const key = extConfig[action];
  return typeof key === "string" ? key : undefined;
}

export function readKeybindingsFile(filePath: string): KeybindingsConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null) return null;
    return raw as KeybindingsConfig;
  } catch {
    return null;
  }
}
