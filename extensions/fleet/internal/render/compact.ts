export const COMPACT_MAX_LINES = 8;
export const COMPACT_HEADER_LINES = 2;
export const COMPACT_STREAM_BODY_LINES = 5;
export const COMPACT_OVERFLOW_PREFIX = "··· ";

export interface CompactOverflowTheme {
  fg(token: string, text: string): string;
}

export function clampCompletedCompactLines(
  lines: readonly string[],
  theme: CompactOverflowTheme,
): string[] {
  if (lines.length <= COMPACT_MAX_LINES) return [...lines];

  const visibleCount = COMPACT_MAX_LINES - 1;
  const hiddenCount = lines.length - visibleCount;
  return [
    ...lines.slice(0, visibleCount),
    theme.fg("dim", `${COMPACT_OVERFLOW_PREFIX}${hiddenCount} more lines`),
  ];
}
