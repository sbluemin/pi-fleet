import type { Component, Focusable } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";

import type { SectionDisplayConfig } from "@sbluemin/fleet-core/services/settings";

const LABEL_WIDTH = 11;
const PANEL_COLOR = "\x1b[38;2;180;160;220m";
const ANSI_RESET = "\x1b[0m";

export class SettingsOverlay implements Component, Focusable {
  focused = false;

  private readonly theme: Theme;
  private readonly sections: SectionDisplayConfig[];
  private readonly done: () => void;

  constructor(
    theme: Theme,
    sections: SectionDisplayConfig[],
    done: () => void,
  ) {
    this.theme = theme;
    this.sections = sections;
    this.done = done;
  }

  handleInput(): void {
    this.done();
  }

  render(width: number): string[] {
    width = Math.max(30, width);

    const border = (s: string) => this.theme.fg("border", s);
    const dim = (s: string) => this.theme.fg("dim", s);
    const innerWidth = width - 4;
    const row = (content: string) => {
      const pad = Math.max(0, innerWidth - visibleWidth(content));
      return border("│ ") + content + " ".repeat(pad) + border(" │");
    };
    const emptyRow = () => row("");
    const settingRow = (label: string, value: string, color: string) => {
      const paddedLabel = " ".repeat(Math.max(0, LABEL_WIDTH - label.length)) + label;
      return row(`  ${dim(paddedLabel)}  ${this.theme.fg(color as ThemeColor, value)}`);
    };

    const title = " Settings ";
    const titleLen = title.length;
    const sideLen = Math.max(0, Math.floor((width - 2 - titleLen) / 2));
    const rightLen = Math.max(0, width - 2 - sideLen - titleLen);
    const topBorder = border("╭" + "─".repeat(sideLen) + title + "─".repeat(rightLen) + "╮");
    const lines: string[] = [];
    lines.push(topBorder);
    lines.push(emptyRow());

    for (const section of this.sections) {
      lines.push(row(`  ${PANEL_COLOR}◇${ANSI_RESET} ${PANEL_COLOR}${section.displayName}${ANSI_RESET}`));
      const fields = section.getDisplayFields();
      for (const field of fields) {
        lines.push(settingRow(field.label, field.value, field.color ?? "accent"));
      }
      lines.push(emptyRow());
    }

    if (this.sections.length === 0) {
      lines.push(row(dim("등록된 설정 섹션이 없습니다.")));
      lines.push(emptyRow());
    }

    lines.push(border("├" + "─".repeat(width - 2) + "┤"));
    lines.push(row(dim("Esc close")));
    lines.push(border("╰" + "─".repeat(width - 2) + "╯"));

    return lines;
  }

  invalidate(): void {}

  dispose(): void {}
}
