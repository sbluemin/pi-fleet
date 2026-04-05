// core-shell — 설정 로드
// 순수 쉘 팝업 유틸리티의 로컬/프로젝트 설정을 읽습니다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export interface PopupConfig {
  exitAutoCloseDelay: number;
  overlayWidthPercent: number;
  overlayHeightPercent: number;
  scrollbackLines: number;
  ansiReemit: boolean;
}

const DEFAULT_CONFIG: PopupConfig = {
  exitAutoCloseDelay: 3,
  overlayWidthPercent: 95,
  overlayHeightPercent: 60,
  scrollbackLines: 5000,
  ansiReemit: true,
};

export function loadConfig(cwd: string): PopupConfig {
  const projectPath = join(cwd, ".pi", "core-shell.json");
  const globalPath = join(getAgentDir(), "core-shell.json");

  let globalConfig: Partial<PopupConfig> = {};
  let projectConfig: Partial<PopupConfig> = {};

  if (existsSync(globalPath)) {
    try {
      globalConfig = JSON.parse(readFileSync(globalPath, "utf-8")) as Partial<PopupConfig>;
    } catch (error) {
      console.error(`[core-shell] 전역 설정 파싱 실패: ${String(error)}`);
    }
  }

  if (existsSync(projectPath)) {
    try {
      projectConfig = JSON.parse(readFileSync(projectPath, "utf-8")) as Partial<PopupConfig>;
    } catch (error) {
      console.error(`[core-shell] 프로젝트 설정 파싱 실패: ${String(error)}`);
    }
  }

  const merged = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };

  return {
    exitAutoCloseDelay: clampInt(merged.exitAutoCloseDelay, DEFAULT_CONFIG.exitAutoCloseDelay, 0, 30),
    overlayWidthPercent: clampInt(merged.overlayWidthPercent, DEFAULT_CONFIG.overlayWidthPercent, 10, 100),
    overlayHeightPercent: clampInt(merged.overlayHeightPercent, DEFAULT_CONFIG.overlayHeightPercent, 20, 90),
    scrollbackLines: clampInt(merged.scrollbackLines, DEFAULT_CONFIG.scrollbackLines, 200, 50000),
    ansiReemit: merged.ansiReemit !== false,
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
