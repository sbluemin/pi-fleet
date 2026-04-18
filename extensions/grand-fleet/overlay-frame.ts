import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

export interface OverlayFrame {
  bottomBorder: string;
  emptyRow: () => string;
  innerWidth: number;
  row: (content: string) => string;
  separator: () => string;
  topBorder: string;
}

export function createOverlayFrame(
  theme: Theme,
  width: number,
  title: string,
  ansiReset: string,
): OverlayFrame {
  const border = (value: string) => theme.fg("border", value);
  const dimEllipsis = theme.fg("dim", "…");
  const innerWidth = width - 4;
  const titleLen = title.length;
  const sideLen = Math.max(0, Math.floor((width - 2 - titleLen) / 2));
  const rightLen = Math.max(0, width - 2 - sideLen - titleLen);

  const row = (content: string) => {
    if (visibleWidth(content) > innerWidth) {
      const truncated = `${truncateAnsiContent(content, innerWidth - 1)}${ansiReset}${dimEllipsis}`;
      const pad = Math.max(0, innerWidth - visibleWidth(truncated));
      return border("│ ") + truncated + " ".repeat(pad) + border(" │");
    }

    const pad = Math.max(0, innerWidth - visibleWidth(content));
    return border("│ ") + content + " ".repeat(pad) + border(" │");
  };

  return {
    bottomBorder: border("╰" + "─".repeat(width - 2) + "╯"),
    emptyRow: () => row(""),
    innerWidth,
    row,
    separator: () => border("├" + "─".repeat(width - 2) + "┤"),
    topBorder: border("╭" + "─".repeat(sideLen) + title + "─".repeat(rightLen) + "╮"),
  };
}

function truncateAnsiContent(content: string, maxVisibleWidth: number): string {
  let visible = 0;
  let cutIndex = content.length;

  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\x1b") {
      const end = content.indexOf("m", index);
      if (end !== -1) {
        index = end;
        continue;
      }
    }

    visible++;
    if (visible >= maxVisibleWidth) {
      cutIndex = index + 1;
      break;
    }
  }

  return content.slice(0, cutIndex);
}
