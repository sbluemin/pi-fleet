import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { LogLevel } from "@sbluemin/fleet-core/core-services/log";
import { CORE_LOG_FOOTER_KEY } from "@sbluemin/fleet-core/core-services/log";
import { loadSettings, getLatestVisibleLogs } from "@sbluemin/fleet-core/core-services/log";
import { getSettingsAPI } from "../config/settings/bridge.js";

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "dim",
  info: "accent",
  warn: "warning",
  error: "error",
};
const FOOTER_MAX_LINES = 5;

export default function registerLogLifecycle(pi: ExtensionAPI) {
  const settingsApi = getSettingsAPI();
  settingsApi?.registerSection({
    key: "core-log",
    displayName: "Log",
    getDisplayFields() {
      const s = loadSettings();
      return [
        { label: "Enabled", value: s.enabled ? "ON" : "OFF", color: s.enabled ? "accent" : "dim" },
        { label: "File Log", value: s.fileLog ? "ON" : "OFF", color: s.fileLog ? "accent" : "dim" },
        { label: "Footer", value: s.footerDisplay ? "ON" : "OFF", color: s.footerDisplay ? "accent" : "dim" },
        { label: "Min Level", value: s.minLevel, color: LOG_LEVEL_COLORS[s.minLevel] },
      ];
    },
  });

  pi.on("session_start", async () => {
    clearFooterBridge();

    const settings = loadSettings();
    if (settings.enabled && settings.footerDisplay) {
      updateFooterBridge();
    }
  });
}

function getBridge(): { lines: string[] | null; requestRender: (() => void) | null } {
  if (!(globalThis as any)[CORE_LOG_FOOTER_KEY]) {
    (globalThis as any)[CORE_LOG_FOOTER_KEY] = { lines: null, requestRender: null };
  }
  return (globalThis as any)[CORE_LOG_FOOTER_KEY];
}

function updateFooterBridge(): void {
  const settings = loadSettings();
  const entries = getLatestVisibleLogs(settings.minLevel, FOOTER_MAX_LINES);
  if (entries.length === 0) {
    clearFooterBridge();
    return;
  }

  const lines = entries.map((entry) => {
    const time = entry.timestamp.slice(11, 19);
    const levelTag = entry.level.toUpperCase().padEnd(5);
    return `[${time}] ${levelTag} [${entry.source}] ${entry.message}`;
  });

  const bridge = getBridge();
  bridge.lines = lines;
  bridge.requestRender?.();
}

function clearFooterBridge(): void {
  const bridge = getBridge();
  bridge.lines = null;
  bridge.requestRender?.();
}
