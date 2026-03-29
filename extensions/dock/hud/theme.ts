/**
 * Theme system for hud
 * 
 * Colors are resolved in order:
 * 1. User overrides from theme.json (if exists)
 * 2. Preset colors
 * 3. Default colors
 */

import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ColorScheme, ColorValue, SemanticColor } from "./types.js";

// Default color scheme (uses pi theme colors)
const DEFAULT_COLORS: Required<ColorScheme> = {
  pi: "accent",
  model: "#d787af",  // Pink/mauve (matching original colors.ts)
  path: "#00afaf",  // Teal/cyan (matching original colors.ts)
  git: "success",
  gitDirty: "warning",
  gitClean: "success",
  thinking: "muted",
  thinkingHigh: "accent",
  context: "dim",
  contextWarn: "warning",
  contextError: "error",
  cost: "text",
  tokens: "muted",
  separator: "dim",
  border: "borderMuted",
};

// Geek color scheme — Tokyo Night + Cyberpunk Neon 혼합
// 레퍼런스: https://github.com/folke/tokyonight.nvim
const GEEK_COLORS: Required<ColorScheme> = {
  pi: "#FDF500",        // Electric Yellow — pi 아이덴티티
  model: "#BB9AF7",     // Tokyo Night Purple — AI/모델
  path: "#73DACA",      // Tokyo Night Cyan — 파일시스템
  git: "#9ECE6A",       // Tokyo Night Green — 클린 브랜치
  gitDirty: "#E0AF68",  // Tokyo Night Orange — 변경 있음
  gitClean: "#9ECE6A",  // Tokyo Night Green
  thinking: "#F7768E",  // Neon Pink — 연산 활성화
  thinkingHigh: "#FF9E64", // Warm Orange — 높은 연산
  context: "#7AA2F7",   // Tokyo Night Blue — 컨텍스트 정상
  contextWarn: "#E0AF68",  // Orange — 70%+
  contextError: "#F7768E", // Neon Pink — 90%+
  cost: "#FF9E64",      // Warm Orange — 비용
  tokens: "#565F89",    // Tokyo Night dim blue — 토큰(muted)
  separator: "#3D59A1", // Tokyo Night dark blue — 구분선
  border: "#3D59A1",    // Tokyo Night dark blue — 테두리
};

// Rainbow colors for high thinking levels
const RAINBOW_COLORS = [
  "#b281d6", "#d787af", "#febc38", "#e4c00f", 
  "#89d281", "#00afaf", "#178fb9", "#b281d6",
];

// Cache for user theme overrides
let userThemeCache: ColorScheme | null = null;
let userThemeCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get the path to the hud theme override file
 */
function getThemePath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return join(homeDir, ".pi", "agent", "hud-theme.json");
}

/**
 * Load user theme overrides from theme.json
 */
function loadUserTheme(): ColorScheme {
  const now = Date.now();
  if (userThemeCache && now - userThemeCacheTime < CACHE_TTL) {
    return userThemeCache;
  }

  const themePath = getThemePath();
  try {
    if (existsSync(themePath)) {
      const content = readFileSync(themePath, "utf-8");
      const parsed = JSON.parse(content);
      userThemeCache = parsed.colors ?? {};
      userThemeCacheTime = now;
      return userThemeCache;
    }
  } catch {
    // Ignore errors, use defaults
  }

  userThemeCache = {};
  userThemeCacheTime = now;
  return userThemeCache;
}

/**
 * Resolve a semantic color to an actual color value
 */
export function resolveColor(
  semantic: SemanticColor,
  presetColors?: ColorScheme
): ColorValue {
  const userTheme = loadUserTheme();
  
  // Priority: user overrides > preset colors > defaults
  return userTheme[semantic] 
    ?? presetColors?.[semantic] 
    ?? DEFAULT_COLORS[semantic];
}

/**
 * Check if a color value is a hex color
 */
function isHexColor(color: ColorValue): color is `#${string}` {
  return typeof color === "string" && color.startsWith("#");
}

/**
 * Convert hex color to ANSI escape code
 */
function hexToAnsi(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Apply a color to text using the pi theme or custom hex
 */
export function applyColor(
  theme: Theme,
  color: ColorValue,
  text: string
): string {
  if (isHexColor(color)) {
    return `${hexToAnsi(color)}${text}\x1b[0m`;
  }
  return theme.fg(color as ThemeColor, text);
}

/**
 * Apply a semantic color to text
 */
export function fg(
  theme: Theme,
  semantic: SemanticColor,
  text: string,
  presetColors?: ColorScheme
): string {
  const color = resolveColor(semantic, presetColors);
  return applyColor(theme, color, text);
}

/**
 * Apply rainbow gradient to text (for high thinking levels)
 */
export function rainbow(text: string): string {
  let result = "";
  let colorIndex = 0;
  for (const char of text) {
    if (char === " " || char === ":") {
      result += char;
    } else {
      result += hexToAnsi(RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length]) + char;
      colorIndex++;
    }
  }
  return result + "\x1b[0m";
}

/**
 * Get the default color scheme
 */
export function getDefaultColors(): Required<ColorScheme> {
  return { ...DEFAULT_COLORS };
}

/**
 * Get the geek color scheme (Tokyo Night + Cyberpunk Neon)
 */
export function getGeekColors(): Required<ColorScheme> {
  return { ...GEEK_COLORS };
}
