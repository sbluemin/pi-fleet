import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getOverrideKeyFromConfig,
  loadKeybindingsFromPaths,
  type KeybindingsConfig,
} from "@sbluemin/fleet-core/services/keybind";

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KEYBINDINGS_PATH = path.resolve(EXT_DIR, "..", "keybindings.json");
const KEYBINDINGS_DEFAULT_PATH = path.resolve(EXT_DIR, "..", "keybindings.default.json");

export function loadKeybindings(): KeybindingsConfig {
  return loadKeybindingsFromPaths(KEYBINDINGS_PATH, KEYBINDINGS_DEFAULT_PATH);
}

export function getOverrideKey(extension: string, action: string): string | undefined {
  return getOverrideKeyFromConfig(loadKeybindings(), extension, action);
}
