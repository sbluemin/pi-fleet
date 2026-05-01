import type { Component, Focusable } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

import type { ResolvedBinding } from "./types.js";

const KEY_WIDTH = 14;
const PANEL_COLOR = "\x1b[38;2;180;160;220m";
const ANSI_RESET = "\x1b[0m";

export class KeybindOverlay implements Component, Focusable {
  focused = false;

  private readonly theme: Theme;
  private readonly bindings: ResolvedBinding[];
  private readonly done: () => void;

  constructor(
    theme: Theme,
    bindings: ResolvedBinding[],
    done: () => void,
  ) {
    this.theme = theme;
    this.bindings = bindings;
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
    const bindingRow = (key: string, description: string, conflicted?: boolean) => {
      const displayKey = key.replace(/\b\w/g, (c) => c.toUpperCase());
      const paddedKey = " ".repeat(Math.max(0, KEY_WIDTH - displayKey.length)) + displayKey;
      const marker = conflicted ? this.theme.fg("warning", " ⚠") : "  ";
      const keyColor = conflicted ? "warning" : "accent";
      return row(`${marker}${this.theme.fg(keyColor, paddedKey)}  ${dim(description)}`);
    };

    const title = " Keybindings ";
    const titleLen = title.length;
    const sideLen = Math.max(0, Math.floor((width - 2 - titleLen) / 2));
    const rightLen = Math.max(0, width - 2 - sideLen - titleLen);
    const topBorder = border("╭" + "─".repeat(sideLen) + title + "─".repeat(rightLen) + "╮");
    const lines: string[] = [];
    lines.push(topBorder);
    lines.push(emptyRow());

    const categories = new Map<string, ResolvedBinding[]>();
    for (const binding of this.bindings) {
      const cat = binding.category ?? binding.extension;
      const list = categories.get(cat) ?? [];
      list.push(binding);
      categories.set(cat, list);
    }

    for (const [category, items] of categories) {
      lines.push(row(`  ${PANEL_COLOR}◇${ANSI_RESET} ${PANEL_COLOR}${category}${ANSI_RESET}`));
      for (const item of items) {
        lines.push(bindingRow(item.resolvedKey, item.description, item.conflicted));
      }
      lines.push(emptyRow());
    }

    if (this.bindings.length === 0) {
      lines.push(row(dim("등록된 키바인딩이 없습니다.")));
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
