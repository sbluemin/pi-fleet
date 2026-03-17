// ANSI escape codes for colors
// Matching oh-my-pi dark theme colors exactly

export interface AnsiColors {
  getBgAnsi(r: number, g: number, b: number): string;
  getFgAnsi(r: number, g: number, b: number): string;
  getFgAnsi256(code: number): string;
  reset: string;
}

export const ansi: AnsiColors = {
  getBgAnsi: (r, g, b) => `\x1b[48;2;${r};${g};${b}m`,
  getFgAnsi: (r, g, b) => `\x1b[38;2;${r};${g};${b}m`,
  getFgAnsi256: (code) => `\x1b[38;5;${code}m`,
  reset: "\x1b[0m",
};

// Convert hex to RGB tuple
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// oh-my-pi dark theme colors (exact match)
const THEME = {
  // Status line colors
  sep: 244,                           // ANSI 256 gray
  model: "#d787af",                   // Pink/mauve
  path: "#00afaf",                    // Teal/cyan
  gitClean: "#5faf5f",                // Green
  gitDirty: "#d7af5f",                // Gold/orange
  context: "#8787af",                 // Purple-gray
  spend: "#5fafaf",                   // Teal
  staged: 70,                         // ANSI 256 green
  unstaged: 178,                      // ANSI 256 gold
  untracked: 39,                      // ANSI 256 blue
  output: 205,                        // ANSI 256 pink
  cost: 205,                          // ANSI 256 pink
  subagents: "#febc38",               // Accent orange

  // UI colors
  accent: "#febc38",                  // Orange (for pi icon)
  border: "#178fb9",                  // Blue (for box border)
  warning: "#e4c00f",                 // Yellow
  error: "#fc3a4b",                   // Red
  text: "",                           // Default terminal color

  // Thinking level colors (gradient from dim to bright)
  thinkingOff: "#3d424a",             // Dark gray
  thinkingMinimal: "#5f6673",         // Dim gray
  thinkingLow: "#178fb9",             // Blue
  thinkingMedium: "#0088fa",          // Bright blue
  thinkingHigh: "#b281d6",            // Purple
  thinkingXhigh: "#e5c1ff",           // Bright lavender
};

// Color name to ANSI code mapping
type ColorName = 
  | "sep" | "model" | "path" | "gitClean" | "gitDirty" 
  | "context" | "spend" | "staged" | "unstaged" | "untracked"
  | "output" | "cost" | "subagents" | "accent" | "border"
  | "warning" | "error" | "text"
  | "thinkingOff" | "thinkingMinimal" | "thinkingLow" 
  | "thinkingMedium" | "thinkingHigh" | "thinkingXhigh";

function getAnsiCode(color: ColorName): string {
  const value = THEME[color as keyof typeof THEME];
  
  if (value === undefined || value === "") {
    return ""; // No color, use terminal default
  }
  
  if (typeof value === "number") {
    return ansi.getFgAnsi256(value);
  }
  
  if (typeof value === "string" && value.startsWith("#")) {
    const [r, g, b] = hexToRgb(value);
    return ansi.getFgAnsi(r, g, b);
  }
  
  return "";
}

// Helper to apply foreground color only (no reset - caller manages reset)
export function fgOnly(color: ColorName, text: string): string {
  const code = getAnsiCode(color);
  return code ? `${code}${text}` : text;
}

// Get raw ANSI code for a color
export function getFgAnsiCode(color: ColorName): string {
  return getAnsiCode(color);
}

