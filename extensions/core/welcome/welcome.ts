import { execSync } from "node:child_process";
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
// ── welcome 전용 ANSI 색상 헬퍼 (HUD colors.ts 비의존) ──

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANSI_RESET = "\x1b[0m";

/** 색상 이름 → ANSI 코드 매핑 (welcome에서 사용하는 색상만) */
const WELCOME_COLORS: Record<string, string> = {
  sep: "\x1b[38;5;244m",
  model: "\x1b[38;2;215;135;175m",
  path: "\x1b[38;2;0;175;175m",
  gitClean: "\x1b[38;2;95;175;95m",
  accent: "\x1b[38;2;254;188;56m",
  warn: "\x1b[38;2;255;179;71m",
  alert: "\x1b[38;2;255;85;85m",
};

const ansi = {
  reset: ANSI_RESET,
};

/** 전경색만 적용 (reset 없이) */
function fgOnly(color: string, text: string): string {
  const code = WELCOME_COLORS[color];
  return code ? `${code}${text}` : text;
}

/** 전경색 ANSI 코드 반환 */
function getFgAnsiCode(color: string): string {
  return WELCOME_COLORS[color] ?? "";
}

export interface RecentSession {
  name: string;
  timeAgo: string;
}

export interface LoadedCounts {
  contextFiles: number;
  extensions: number;
  skills: number;
  promptTemplates: number;
}

export interface GitUpdateStatus {
  behind: number;
  branch: string;
  hasRemote: boolean;
  isGitRepo: boolean;
  upstream?: string;
  version?: string;
}

interface WelcomeData {
  modelName: string;
  providerName: string;
  recentSessions: RecentSession[];
  loadedCounts: LoadedCounts;
  gitUpdate?: GitUpdateStatus;
}

interface FleetPackageJson {
  version?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared rendering utilities
// ═══════════════════════════════════════════════════════════════════════════

// Fleet block letter ASCII 배너 (5줄, 23자 폭)
const FLEET_BANNER = [
  "████ █    ████ ████ ███",
  "█    █    █    █     █ ",
  "███  █    ███  ███   █ ",
  "█    █    █    █     █ ",
  "█    ████ ████ ████  █ ",
];

// cyan-blue 그라데이션 (기존 pink-purple 교체)
const GRADIENT_COLORS = [
  "\x1b[38;5;51m",
  "\x1b[38;5;45m",
  "\x1b[38;5;39m",
  "\x1b[38;5;33m",
  "\x1b[38;5;27m",
  "\x1b[38;5;21m",
];

const MIN_LAYOUT_WIDTH = 44;
const MIN_WELCOME_WIDTH = 76;
const MAX_WELCOME_WIDTH = 96;

// ═══════════════════════════════════════════════════════════════════════════
// Welcome Components
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Welcome overlay component for pi agent.
 * Displays a branded splash screen with logo, tips, and loaded counts.
 */
export class WelcomeComponent implements Component {
  private data: WelcomeData;
  private countdown: number = 30;

  constructor(
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedCounts: LoadedCounts = { contextFiles: 0, extensions: 0, skills: 0, promptTemplates: 0 },
    gitUpdate?: GitUpdateStatus,
  ) {
    this.data = { modelName, providerName, recentSessions, loadedCounts, gitUpdate };
  }

  setCountdown(seconds: number): void {
    this.countdown = seconds;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    // Minimum width for two-column layout (must match renderWelcomeBox)
    if (termWidth < MIN_LAYOUT_WIDTH) {
      return [];
    }

    const boxWidth = getWelcomeBoxWidth(termWidth);

    // Bottom line with countdown
    const countdownText = ` Press any key to continue (${this.countdown}s) `;
    const countdownStyled = dim(countdownText);
    const bottomContentWidth = boxWidth - 2;
    const countdownVisLen = visibleWidth(countdownText);
    const leftPad = Math.floor((bottomContentWidth - countdownVisLen) / 2);
    const rightPad = bottomContentWidth - countdownVisLen - leftPad;
    const hChar = "─";
    const bottomLine = dim(hChar.repeat(Math.max(0, leftPad))) +
      countdownStyled +
      dim(hChar.repeat(Math.max(0, rightPad)));

    const bannerLines = renderUpdateAlertBanner(this.data.gitUpdate, termWidth);
    const boxLines = renderWelcomeBox(this.data, termWidth, bottomLine);
    return bannerLines.length > 0 ? [...bannerLines, ...boxLines] : boxLines;
  }
}

/**
 * Welcome header - same layout as overlay but persistent (no countdown).
 * Welcome header — persistent Fleet banner rendered on session start.
 */
export class WelcomeHeader implements Component {
  private data: WelcomeData;

  constructor(
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedCounts: LoadedCounts = { contextFiles: 0, extensions: 0, skills: 0, promptTemplates: 0 },
    gitUpdate?: GitUpdateStatus,
  ) {
    this.data = { modelName, providerName, recentSessions, loadedCounts, gitUpdate };
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    // Minimum width for two-column layout (must match renderWelcomeBox)
    if (termWidth < MIN_LAYOUT_WIDTH) {
      return [];
    }

    const boxWidth = getWelcomeBoxWidth(termWidth);
    const hChar = "─";

    // Bottom line with column separator (leftCol=26, rightCol=boxWidth-29)
    const leftCol = 26;
    const rightCol = Math.max(1, boxWidth - leftCol - 3);
    const bottomLine = dim(hChar.repeat(leftCol)) + dim("┴") + dim(hChar.repeat(rightCol));

    const bannerLines = renderUpdateAlertBanner(this.data.gitUpdate, termWidth);
    const lines = renderWelcomeBox(this.data, termWidth, bottomLine);
    if (bannerLines.length > 0) {
      lines.unshift(...bannerLines);
    }
    if (lines.length > 0) {
      lines.push(""); // Add empty line for spacing only if we rendered content
    }
    return lines;
  }
}

/**
 * Discover loaded counts by scanning filesystem.
 */
export function discoverLoadedCounts(): LoadedCounts {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const cwd = process.cwd();

  let contextFiles = 0;
  let extensions = 0;
  let skills = 0;
  let promptTemplates = 0;

  const agentsMdPaths = [
    join(homeDir, ".pi", "agent", "AGENTS.md"),
    join(homeDir, ".claude", "AGENTS.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, ".pi", "AGENTS.md"),
    join(cwd, ".claude", "AGENTS.md"),
  ];

  for (const path of agentsMdPaths) {
    if (existsSync(path)) contextFiles++;
  }

  const extensionDirs = [
    join(homeDir, ".pi", "agent", "extensions"),
    join(cwd, "extensions"),
    join(cwd, ".pi", "extensions"),
  ];

  const countedExtensions = new Set<string>();

  for (const dir of extensionDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);
          const stats = statSync(entryPath);

          if (stats.isDirectory()) {
            if (existsSync(join(entryPath, "index.ts")) || existsSync(join(entryPath, "package.json"))) {
              if (!countedExtensions.has(entry)) {
                countedExtensions.add(entry);
                extensions++;
              }
            }
          } else if (entry.endsWith(".ts") && !entry.startsWith(".")) {
            const name = basename(entry, ".ts");
            if (!countedExtensions.has(name)) {
              countedExtensions.add(name);
              extensions++;
            }
          }
        }
      } catch {}
    }
  }

  const skillDirs = [
    join(homeDir, ".pi", "agent", "skills"),
    join(cwd, ".pi", "skills"),
    join(cwd, "skills"),
  ];

  const countedSkills = new Set<string>();

  for (const dir of skillDirs) {
    if (existsSync(dir)) {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const entryPath = join(dir, entry);
          try {
            if (statSync(entryPath).isDirectory()) {
              if (existsSync(join(entryPath, "SKILL.md"))) {
                if (!countedSkills.has(entry)) {
                  countedSkills.add(entry);
                  skills++;
                }
              }
            }
          } catch {}
        }
      } catch {}
    }
  }

  const templateDirs = [
    join(homeDir, ".pi", "agent", "commands"),
    join(homeDir, ".claude", "commands"),
    join(cwd, ".pi", "commands"),
    join(cwd, ".claude", "commands"),
  ];

  const countedTemplates = new Set<string>();

  function countTemplatesInDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            countTemplatesInDir(entryPath);
          } else if (entry.endsWith(".md")) {
            const name = basename(entry, ".md");
            if (!countedTemplates.has(name)) {
              countedTemplates.add(name);
              promptTemplates++;
            }
          }
        } catch {}
      }
    } catch {}
  }

  for (const dir of templateDirs) {
    countTemplatesInDir(dir);
  }

  return { contextFiles, extensions, skills, promptTemplates };
}

export function checkGitUpdateStatus(): GitUpdateStatus {
  const version = readFleetVersion();
  let branch = "";

  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: __dirname,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return { behind: 0, branch: "", hasRemote: false, isGitRepo: false, version };
  }

  try {
    const upstream = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
      cwd: __dirname,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const behindRaw = execSync("git rev-list HEAD..@{u} --count", {
      cwd: __dirname,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const behind = Number.parseInt(behindRaw, 10);

    return {
      behind: Number.isFinite(behind) ? behind : 0,
      branch,
      hasRemote: true,
      isGitRepo: true,
      upstream,
      version,
    };
  } catch {
    return { behind: 0, branch, hasRemote: false, isGitRepo: true, version };
  }
}

/**
 * Get recent sessions from the sessions directory.
 */
export function getRecentSessions(maxCount: number = 3): RecentSession[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";

  const sessionsDirs = [
    join(homeDir, ".pi", "agent", "sessions"),
    join(homeDir, ".pi", "sessions"),
  ];

  const sessions: { name: string; mtime: number }[] = [];

  function scanDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            scanDir(entryPath);
          } else if (entry.endsWith(".jsonl")) {
            const parentName = basename(dir);
            let projectName = parentName;
            if (parentName.startsWith("--")) {
              const parts = parentName.split("-").filter(p => p);
              projectName = parts[parts.length - 1] || parentName;
            }
            sessions.push({ name: projectName, mtime: stats.mtimeMs });
          }
        } catch {}
      }
    } catch {}
  }

  for (const sessionsDir of sessionsDirs) {
    scanDir(sessionsDir);
  }

  if (sessions.length === 0) return [];

  sessions.sort((a, b) => b.mtime - a.mtime);

  const seen = new Set<string>();
  const uniqueSessions: typeof sessions = [];
  for (const s of sessions) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      uniqueSessions.push(s);
    }
  }

  const now = Date.now();
  return uniqueSessions.slice(0, maxCount).map(s => ({
    name: s.name.length > 20 ? s.name.slice(0, 17) + "…" : s.name,
    timeAgo: formatTimeAgo(now - s.mtime),
  }));
}

function readFleetVersion(): string {
  try {
    const packageJsonPath = join(__dirname, "..", "..", "..", "package.json");
    if (!existsSync(packageJsonPath)) return "";

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as FleetPackageJson;
    return typeof packageJson.version === "string" ? packageJson.version : "";
  } catch {
    return "";
  }
}


function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`;
}

function boldFg(color: string, text: string): string {
  const code = getFgAnsiCode(color);
  return code ? `\x1b[1m${code}${text}${ansi.reset}` : bold(text);
}

function dim(text: string): string {
  return getFgAnsiCode("sep") + text + ansi.reset;
}

function checkmark(): string {
  return fgOnly("gitClean", "✓");
}

function gradientLine(line: string): string {
  const reset = ansi.reset;
  let result = "";
  let colorIdx = 0;
  const step = Math.max(1, Math.floor(line.length / GRADIENT_COLORS.length));

  for (let i = 0; i < line.length; i++) {
    if (i > 0 && i % step === 0 && colorIdx < GRADIENT_COLORS.length - 1) colorIdx++;
    const char = line[i];
    if (char !== " ") {
      result += GRADIENT_COLORS[colorIdx] + char + reset;
    } else {
      result += char;
    }
  }
  return result;
}

function centerText(text: string, width: number): string {
  const visLen = visibleWidth(text);
  if (visLen > width) return truncateToWidth(text, width);
  if (visLen === width) return text;
  const leftPad = Math.floor((width - visLen) / 2);
  const rightPad = width - visLen - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

function fitToWidth(str: string, width: number): string {
  const visLen = visibleWidth(str);
  if (visLen > width) return truncateToWidth(str, width);
  return str + " ".repeat(width - visLen);
}

function truncateToWidth(str: string, width: number): string {
  const ellipsis = "…";
  const maxWidth = Math.max(0, width - 1);
  let truncated = "";
  let currentWidth = 0;
  let inEscape = false;

  for (const char of str) {
    if (char === "\x1b") inEscape = true;
    if (inEscape) {
      truncated += char;
      if (char === "m") inEscape = false;
    } else if (currentWidth < maxWidth) {
      truncated += char;
      currentWidth++;
    }
  }

  if (visibleWidth(str) > width) return truncated + ellipsis;
  return truncated;
}

function sanitizeDisplay(value: string): string {
  return value.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
}

function getWelcomeBoxWidth(termWidth: number): number {
  // renderWelcomeBox와 배너의 좌우 정렬선이 어긋나지 않도록 단일 규칙을 사용한다.
  return Math.min(termWidth, Math.max(MIN_WELCOME_WIDTH, Math.min(termWidth - 2, MAX_WELCOME_WIDTH)));
}

function applyHorizontalPadding(lines: string[], termWidth: number, boxWidth: number): string[] {
  const hPad = Math.max(0, Math.floor((termWidth - boxWidth) / 2));
  if (hPad === 0) return lines;
  const pad = " ".repeat(hPad);
  return lines.map((line) => pad + line);
}

function renderUpdateAlertBanner(gitUpdate: GitUpdateStatus | undefined, termWidth: number): string[] {
  if (
    termWidth < MIN_LAYOUT_WIDTH ||
    !gitUpdate?.hasRemote ||
    gitUpdate.behind <= 0
  ) {
    return [];
  }

  const boxWidth = getWelcomeBoxWidth(termWidth);
  const contentWidth = boxWidth - 2;
  const hChar = "═";
  const borderColor = "alert";
  const v = boldFg(borderColor, "║");
  const tl = boldFg(borderColor, "╔");
  const tr = boldFg(borderColor, "╗");
  const bl = boldFg(borderColor, "╚");
  const br = boldFg(borderColor, "╝");
  const top = tl + boldFg(borderColor, hChar.repeat(contentWidth)) + tr;
  const bottom = bl + boldFg(borderColor, hChar.repeat(contentWidth)) + br;
  const remoteBranch = sanitizeDisplay(gitUpdate.upstream || gitUpdate.branch || "remote");
  const currentVersion = gitUpdate.version ? `v${sanitizeDisplay(gitUpdate.version)}` : "";

  const contentLines = [
    boldFg("alert", "⚠  UPDATE AVAILABLE  ⚠"),
    fgOnly("warn", `${gitUpdate.behind} commits behind ${remoteBranch}`),
  ];
  if (currentVersion) {
    contentLines.push(fgOnly("accent", `Current ${currentVersion} · Run /fleet:update to sync`));
  }

  const lines = [
    top,
    ...contentLines.map((line) => v + fitToWidth(centerText(line, contentWidth), contentWidth) + v),
    bottom,
  ];

  return applyHorizontalPadding(lines, termWidth, boxWidth);
}

function buildFleetBanner(data: WelcomeData, colWidth: number): string[] {
  const bannerColored = FLEET_BANNER.map((line) => gradientLine(line));

  return [
    "",
    ...bannerColored.map((l) => centerText(l, colWidth)),
    "",
    centerText(fgOnly("model", data.modelName), colWidth),
    centerText(dim(data.providerName), colWidth),
    "",
  ];
}

function buildFleetInfo(data: WelcomeData, colWidth: number): string[] {
  const hChar = "─";
  const separator = ` ${dim(hChar.repeat(colWidth - 2))}`;

  // 최근 세션 섹션
  const sessionLines: string[] = [];
  if (data.recentSessions.length === 0) {
    sessionLines.push(` ${dim("No recent sessions")}`);
  } else {
    for (const session of data.recentSessions.slice(0, 3)) {
      sessionLines.push(
        ` ${dim("▸ ")}${fgOnly("path", session.name)}${dim(` ${session.timeAgo}`)}`,
      );
    }
  }

  // 로드 통계 섹션
  const countLines: string[] = [];
  const { contextFiles, extensions, skills, promptTemplates } = data.loadedCounts;

  if (contextFiles > 0 || extensions > 0 || skills > 0 || promptTemplates > 0) {
    if (contextFiles > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${contextFiles}`)} context file${contextFiles !== 1 ? "s" : ""}`);
    }
    if (extensions > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${extensions}`)} extension${extensions !== 1 ? "s" : ""}`);
    }
    if (skills > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${skills}`)} skill${skills !== 1 ? "s" : ""}`);
    }
    if (promptTemplates > 0) {
      countLines.push(` ${checkmark()} ${fgOnly("gitClean", `${promptTemplates}`)} prompt template${promptTemplates !== 1 ? "s" : ""}`);
    }
  } else {
    countLines.push(` ${dim("Nothing loaded")}`);
  }

  const updateLines: string[] = [];
  if (data.gitUpdate?.isGitRepo && data.gitUpdate.branch) {
    const displayBranch = sanitizeDisplay(data.gitUpdate.branch);
    const currentVersion = data.gitUpdate.version ? `v${sanitizeDisplay(data.gitUpdate.version)}` : "";
    updateLines.push(separator);
    if (!data.gitUpdate.hasRemote) {
      const versionSuffix = currentVersion ? ` · ${currentVersion}` : "";
      updateLines.push(` ${fgOnly("accent", `● Local branch (${displayBranch})${versionSuffix}`)}`);
    } else if (data.gitUpdate.behind === 0) {
      const versionSuffix = currentVersion ? ` · ${currentVersion}` : "";
      updateLines.push(` ${checkmark()} ${fgOnly("gitClean", `Up to date (${displayBranch})${versionSuffix}`)}`);
    }
  }

  return [
    ` ${bold(fgOnly("accent", "Shortcuts"))}`,
    ` ${dim("/")} commands  ${dim("·")} ${dim("!")} shell`,
    ` ${dim("Alt+.")} keybinds`,
    ` ${dim("Alt+H/L")} carriers`,
    separator,
    ` ${bold(fgOnly("accent", "Loaded"))}`,
    ...countLines,
    separator,
    ` ${bold(fgOnly("accent", "Recent"))}`,
    ...sessionLines,
    ...updateLines,
    "",
  ];
}

function renderWelcomeBox(
  data: WelcomeData,
  termWidth: number,
  bottomLine: string,
): string[] {
  // Minimum width for two-column layout: leftCol(26) + separator(3) + minRightCol(15) = 44
  // If terminal is too narrow for the layout, return empty (skip welcome box)
  if (termWidth < MIN_LAYOUT_WIDTH) {
    return [];
  }

  const boxWidth = getWelcomeBoxWidth(termWidth);
  const leftCol = 26;
  const rightCol = Math.max(1, boxWidth - leftCol - 3); // Ensure rightCol is at least 1

  const hChar = "─";
  const v = dim("│");
  const tl = dim("╭");
  const tr = dim("╮");
  const bl = dim("╰");
  const br = dim("╯");

  const leftLines = buildFleetBanner(data, leftCol);
  const rightLines = buildFleetInfo(data, rightCol);

  const lines: string[] = [];

  // 상단 보더 — Fleet 타이틀
  const title = " Fleet ";
  const titlePrefix = dim(hChar.repeat(3));
  const titleStyled = titlePrefix + fgOnly("accent", title);
  const titleVisLen = 3 + visibleWidth(title);
  const afterTitle = boxWidth - 2 - titleVisLen;
  const afterTitleText = afterTitle > 0 ? dim(hChar.repeat(afterTitle)) : "";
  lines.push(tl + titleStyled + afterTitleText + tr);

  // Content rows
  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    const left = fitToWidth(leftLines[i] ?? "", leftCol);
    const right = fitToWidth(rightLines[i] ?? "", rightCol);
    lines.push(v + left + v + right + v);
  }

  // Bottom border
  lines.push(bl + bottomLine + br);

  return applyHorizontalPadding(lines, termWidth, boxWidth);
}

// ═══════════════════════════════════════════════════════════════════════════
// Discovery functions
// ═══════════════════════════════════════════════════════════════════════════

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
