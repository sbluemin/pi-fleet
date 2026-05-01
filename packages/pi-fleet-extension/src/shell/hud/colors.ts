import { hexToRgb } from "./theme.js";

export interface AnsiColors {
  getBgAnsi(r: number, g: number, b: number): string;
  getFgAnsi(r: number, g: number, b: number): string;
  getFgAnsi256(code: number): string;
  reset: string;
}

type ColorName = "sep";

export const ansi: AnsiColors = {
  getBgAnsi: (r, g, b) => `\x1b[48;2;${r};${g};${b}m`,
  getFgAnsi: (r, g, b) => `\x1b[38;2;${r};${g};${b}m`,
  getFgAnsi256: (code) => `\x1b[38;5;${code}m`,
  reset: "\x1b[0m",
};

const THEME: Record<ColorName, string | number> = {
  sep: 244,
};

export function fgOnly(color: ColorName, text: string): string {
  const code = getAnsiCode(color);
  return code ? `${code}${text}` : text;
}

export function getFgAnsiCode(color: ColorName): string {
  return getAnsiCode(color);
}

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
