/**
 * hud/utils.ts — 유틸리티 함수
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** pi settings.json 읽기 */
export function readSettings(): Record<string, unknown> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const settingsPath = join(homeDir, ".pi", "agent", "settings.json");
  try {
    if (existsSync(settingsPath)) {
      return JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
  } catch {}
  return {};
}

/** bash 명령어가 git 브랜치를 변경할 수 있는지 판별 */
export function mightChangeGitBranch(cmd: string): boolean {
  const gitBranchPatterns = [
    /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
    /\bgit\s+stash\s+(pop|apply)/,
  ];
  return gitBranchPatterns.some(p => p.test(cmd));
}
