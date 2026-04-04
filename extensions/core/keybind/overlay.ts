/**
 * infra-keybind/overlay.ts — 키바인딩 오버레이 컴포넌트
 *
 * Component + Focusable 인터페이스를 구현하여
 * ctx.ui.custom() overlay로 등록된 키바인딩을 카테고리별로 렌더링한다.
 */

import type { Component, Focusable } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

import type { ResolvedBinding } from "./types.js";

/** 키 컬럼 너비 (우측 정렬용) */
const KEY_WIDTH = 14;

/** PANEL_COLOR — 카테고리 헤더 라벤더 (unified-agent-direct/constants.ts 동일) */
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
    // 아무 키나 누르면 닫기
    this.done();
  }

  render(width: number): string[] {
    width = Math.max(30, width);

    const border = (s: string) => this.theme.fg("border", s);
    const dim = (s: string) => this.theme.fg("dim", s);

    const innerWidth = width - 4;

    // ── 헬퍼 ──

    /** 좌우 border 안에 콘텐츠를 넣은 한 줄 */
    const row = (content: string) => {
      const pad = Math.max(0, innerWidth - visibleWidth(content));
      return border("│ ") + content + " ".repeat(pad) + border(" │");
    };

    const emptyRow = () => row("");

    /** "  Key  description" 형태의 키바인딩 행 (충돌 시 ⚠ 표시) */
    const bindingRow = (key: string, description: string, conflicted?: boolean) => {
      // 키를 대문자로 표시 (e.g. alt+m → Alt+M)
      const displayKey = key.replace(/\b\w/g, (c) => c.toUpperCase());
      const paddedKey = " ".repeat(Math.max(0, KEY_WIDTH - displayKey.length)) + displayKey;
      const marker = conflicted ? this.theme.fg("warning", " ⚠") : "  ";
      const keyColor = conflicted ? "warning" : "accent";
      return row(`${marker}${this.theme.fg(keyColor, paddedKey)}  ${dim(description)}`);
    };

    // ── 제목 행 ──

    const title = " Keybindings ";
    const titleLen = title.length;
    const sideLen = Math.max(0, Math.floor((width - 2 - titleLen) / 2));
    const rightLen = Math.max(0, width - 2 - sideLen - titleLen);
    const topBorder = border("╭" + "─".repeat(sideLen) + title + "─".repeat(rightLen) + "╮");

    // ── 조립 ──

    const lines: string[] = [];
    lines.push(topBorder);
    lines.push(emptyRow());

    // 카테고리별 그룹핑
    const categories = new Map<string, ResolvedBinding[]>();
    for (const binding of this.bindings) {
      const cat = binding.category ?? binding.extension;
      const list = categories.get(cat) ?? [];
      list.push(binding);
      categories.set(cat, list);
    }

    for (const [category, items] of categories) {
      // 카테고리 헤더: ◇ Bridge
      lines.push(row(
        `  ${PANEL_COLOR}◇${ANSI_RESET} ${PANEL_COLOR}${category}${ANSI_RESET}`,
      ));

      for (const item of items) {
        lines.push(bindingRow(item.resolvedKey, item.description, item.conflicted));
      }

      lines.push(emptyRow());
    }

    // 바인딩이 하나도 없을 때
    if (this.bindings.length === 0) {
      lines.push(row(dim("등록된 키바인딩이 없습니다.")));
      lines.push(emptyRow());
    }

    // 하단
    lines.push(border("├" + "─".repeat(width - 2) + "┤"));
    lines.push(row(dim("Esc close")));
    lines.push(border("╰" + "─".repeat(width - 2) + "╯"));

    return lines;
  }

  invalidate(): void {
    // 정적 표시이므로 캐시 초기화 불필요
  }

  dispose(): void {
    // 정리할 리소스 없음
  }
}
