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

import type { LogLevel } from "@sbluemin/fleet-core/core-services/log";
import { CORE_LOG_FOOTER_KEY } from "@sbluemin/fleet-core/core-services/log";
import { loadSettings, getLatestVisibleLogs } from "@sbluemin/fleet-core/core-services/log";
import { getSettingsAPI } from "../config-bridge/settings/bridge.js";

// ── 상수 ──

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "dim",
  info: "accent",
  warn: "warning",
  error: "error",
};
const FOOTER_MAX_LINES = 5;

// ── 확장 진입점 ──

export default function registerLogLifecycle(pi: ExtensionAPI) {
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

}

/** bridge 객체 접근 — 없으면 생성 (HUD보다 먼저 로드되는 경우 대비) */
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
    const time = entry.timestamp.slice(11, 19); // HH:mm:ss
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
