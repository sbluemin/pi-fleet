/**
 * core-log — 재사용 가능한 로깅 확장
 *
 * 배선(wiring)만 담당:
 *   - globalThis API 등록 (bridge bootstrap)
 *   - 슬래시 커맨드로 on/off 토글
 *   - globalThis footer bridge를 통해 실제 Footer zone에 최근 로그 표시
 *   - Settings 오버레이 섹션 등록
 *
 * Footer 표시 방식:
 *   log → globalThis[CORE_LOG_FOOTER_KEY].lines 갱신 (최대 5줄)
 *   → .requestRender() 호출 → HUD footer render가 즉시 재렌더
 *   (border-bridge.ts 간접 통신 + push 렌더 패턴, hud private 경계 유지)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { CoreLogAPI, LogFooterBridge, LogEntry, LogLevel, LogOptions } from "./types.js";
import { CORE_LOG_FOOTER_KEY, DEFAULT_LOG_CATEGORY } from "./types.js";
import { _bootstrapLog } from "./bridge.js";
import { loadSettings, saveSettings, appendLog, getRecentLogs, getLatestVisibleLog, getLatestVisibleLogs, clearLogs, clearFileLogs } from "./store.js";
import { getSettingsAPI } from "../settings/bridge.js";

// ── 상수 ──

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "dim",
  info: "accent",
  warn: "warning",
  error: "error",
};

// ── 실제 API 구현 ──

function createAPI(): CoreLogAPI {
  const api: CoreLogAPI = {
    debug(source, message, options) {
      api.log("debug", source, message, options);
    },
    info(source, message, options) {
      api.log("info", source, message, options);
    },
    warn(source, message, options) {
      api.log("warn", source, message, options);
    },
    error(source, message, options) {
      api.log("error", source, message, options);
    },
    log(level, source, message, options?: LogOptions) {
      const settings = loadSettings();
      if (!settings.enabled) return;

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        category: options?.category ?? DEFAULT_LOG_CATEGORY,
        source,
        message,
        hideFromFooter: options?.hideFromFooter === true,
      };

      appendLog(entry, settings);

      // globalThis footer bridge 갱신
      if (settings.footerDisplay) {
        updateFooterBridge();
      }
    },
    isEnabled() {
      return loadSettings().enabled;
    },
    setEnabled(enabled) {
      saveSettings({ enabled });
      if (enabled) {
        const settings = loadSettings();
        if (settings.footerDisplay) {
          updateFooterBridge();
        }
      } else {
        clearFooterBridge();
      }
    },
    getRecentLogs(count) {
      return getRecentLogs(count);
    },
  };
  return api;
}

// ── globalThis에 실제 구현 등록 ──

const impl = createAPI();
_bootstrapLog(impl);

// ── 확장 진입점 ──

export default function (pi: ExtensionAPI) {
  // ── Settings 오버레이 섹션 등록 ──

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

  // ── 이벤트 핸들러 ──

  pi.on("session_start", async () => {
    // 세션 전환 시 이전 세션의 stale footer 정리
    clearFooterBridge();

    const settings = loadSettings();
    if (settings.enabled && settings.footerDisplay) {
      updateFooterBridge();
    }
  });

  // ── 슬래시 커맨드 등록 ──

  // fleet:log:toggle — 로그 활성화/비활성화
  pi.registerCommand("fleet:log:toggle", {
    description: "로그 on/off 토글",
    handler: async (_args, ctx) => {
      const settings = loadSettings();
      const newEnabled = !settings.enabled;
      saveSettings({ enabled: newEnabled });

      if (newEnabled && settings.footerDisplay) {
        updateFooterBridge();
      } else if (!newEnabled) {
        clearFooterBridge();
      }

      ctx.ui.notify(
        `로그: ${newEnabled ? "ON" : "OFF"}`,
        "info",
      );
    },
  });

  // fleet:log:settings — 상세 설정 변경
  pi.registerCommand("fleet:log:settings", {
    description: "로그 상세 설정",
    handler: async (_args, ctx) => {
      const current = loadSettings();

      const options = [
        `파일 로그: ${current.fileLog ? "ON" : "OFF"}`,
        `Footer 표시: ${current.footerDisplay ? "ON" : "OFF"}`,
        `최소 레벨: ${current.minLevel}`,
        "화면 로그 초기화 (파일 로그 유지)",
      ];

      const choice = await ctx.ui.select("로그 설정:", options);
      if (choice === undefined) {
        ctx.ui.notify("설정이 취소되었습니다.", "warning");
        return;
      }

      if (choice.startsWith("파일 로그")) {
        saveSettings({ fileLog: !current.fileLog });
        ctx.ui.notify(`파일 로그: ${!current.fileLog ? "ON" : "OFF"}`, "info");
      } else if (choice.startsWith("Footer 표시")) {
        const newFooter = !current.footerDisplay;
        saveSettings({ footerDisplay: newFooter });
        if (!newFooter) {
          clearFooterBridge();
        } else if (current.enabled) {
          updateFooterBridge();
        }
        ctx.ui.notify(`Footer 표시: ${newFooter ? "ON" : "OFF"}`, "info");
      } else if (choice.startsWith("최소 레벨")) {
        const levels: LogLevel[] = ["debug", "info", "warn", "error"];
        const levelChoice = await ctx.ui.select(
          "최소 로그 레벨:",
          levels.map((l) => `${l}${l === current.minLevel ? " [current]" : ""}`),
        );
        if (levelChoice === undefined) {
          ctx.ui.notify("설정이 취소되었습니다.", "warning");
          return;
        }
        const selected = levelChoice.split(" ")[0] as LogLevel;
        saveSettings({ minLevel: selected });
        // minLevel 변경 시 Footer 즉시 재계산 — 최근 로그가 새 레벨에 미달하면 정리
        if (current.enabled && current.footerDisplay) {
          updateFooterBridge();
        }
        ctx.ui.notify(`최소 레벨: ${selected}`, "info");
      } else if (choice.startsWith("화면 로그 초기화")) {
        clearLogs();
        clearFooterBridge();
        ctx.ui.notify("화면 로그가 초기화되었습니다 (파일 로그는 유지).", "info");
      }
    },
  });

  // fleet:log:clear — 인메모리 + 파일 로그 전체 삭제
  pi.registerCommand("fleet:log:clear", {
    description: "로그 전체 삭제 (메모리 + 파일)",
    handler: async (_args, ctx) => {
      clearLogs();
      clearFileLogs();
      clearFooterBridge();
      ctx.ui.notify("모든 로그가 삭제되었습니다 (메모리 + 파일).", "info");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// globalThis Footer bridge 갱신
// ═══════════════════════════════════════════════════════════════════════════

/** bridge 객체 접근 — 없으면 생성 (HUD보다 먼저 로드되는 경우 대비) */
function getBridge(): LogFooterBridge {
  if (!(globalThis as any)[CORE_LOG_FOOTER_KEY]) {
    (globalThis as any)[CORE_LOG_FOOTER_KEY] = { lines: null, requestRender: null };
  }
  return (globalThis as any)[CORE_LOG_FOOTER_KEY];
}

/** 표시할 최대 로그 줄 수 */
const FOOTER_MAX_LINES = 5;

/**
 * 현재 minLevel 기준으로 표시 가능한 최근 로그(최대 5줄)를 bridge.lines에 기록 후
 * bridge.requestRender()를 호출하여 Footer 즉시 재렌더를 트리거한다.
 */
function updateFooterBridge(): void {
  const settings = loadSettings();
  const entries = getLatestVisibleLogs(settings.minLevel, FOOTER_MAX_LINES);
  if (entries.length === 0) {
    clearFooterBridge();
    return;
  }

  const lines = entries.map((entry) => {
    const time = entry.timestamp.slice(11, 19); // HH:mm:ss
    const levelTag = entry.level.toUpperCase().padEnd(5);
    return `[${time}] ${levelTag} [${entry.source}] ${entry.message}`;
  });

  const bridge = getBridge();
  bridge.lines = lines;
  bridge.requestRender?.();
}

/** Footer bridge 정리 (표시 끄기 + 즉시 재렌더) */
function clearFooterBridge(): void {
  const bridge = getBridge();
  bridge.lines = null;
  bridge.requestRender?.();
}
