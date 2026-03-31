import { describe, expect, it } from "vitest";

import { createToolResultRenderer } from "../internal/render/message-renderers.js";
import type { ColBlock } from "../internal/contracts.js";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "").trimEnd();
}

function makeTheme() {
  return {
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function makeTextLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join("\n");
}

function renderToolResultLines(options: {
  expanded: boolean;
  blocks?: ColBlock[];
  contentText?: string;
  thinkingText?: string;
  toolCalls?: { title: string; status: string }[];
}): string[] {
  const renderer = createToolResultRenderer({
    displayName: "Claude",
    color: "",
  });

  const result = {
    content: [{ type: "text" as const, text: options.contentText ?? "" }],
    details: {
      thinking: options.thinkingText,
      toolCalls: options.toolCalls,
      blocks: options.blocks,
    },
  };

  return renderer(result, { expanded: options.expanded }, makeTheme())
    .render(120)
    .map(stripAnsi);
}

describe("createToolResultRenderer", () => {
  it("접힌 상태에서는 완료 결과를 compact 규칙으로 제한한다", () => {
    const lines = renderToolResultLines({
      expanded: false,
      blocks: [
        { type: "thought", text: "internal reasoning" },
        { type: "tool", title: "search", status: "completed" },
        { type: "text", text: makeTextLines(10) },
      ],
    });

    expect(lines).toHaveLength(8);
    expect(lines[2]).toContain("Line 1");
    expect(lines[6]).toContain("Line 5");
    expect(lines[7]).toContain("··· 5 more lines");
    expect(lines.some((line) => line.includes("internal reasoning"))).toBe(false);
    expect(lines.some((line) => line.includes("search"))).toBe(false);
  });

  it("펼친 상태에서는 thought/tool/text 전체를 유지한다", () => {
    const lines = renderToolResultLines({
      expanded: true,
      blocks: [
        { type: "thought", text: "internal reasoning" },
        { type: "tool", title: "search", status: "completed" },
        { type: "text", text: makeTextLines(6) },
      ],
    });

    expect(lines.some((line) => line.includes("internal reasoning"))).toBe(true);
    expect(lines.some((line) => line.includes("search"))).toBe(true);
    expect(lines.some((line) => line.includes("completed"))).toBe(true);
    expect(lines.some((line) => line.includes("Line 6"))).toBe(true);
    expect(lines.some((line) => line.includes("more lines"))).toBe(false);
  });

  it("레거시 details 경로도 접힌 상태에서 compact 규칙을 따른다", () => {
    const lines = renderToolResultLines({
      expanded: false,
      contentText: makeTextLines(10),
      thinkingText: "legacy reasoning",
      toolCalls: [{ title: "legacy-tool", status: "completed" }],
    });

    expect(lines).toHaveLength(8);
    expect(lines[2]).toContain("Line 1");
    expect(lines[7]).toContain("··· 5 more lines");
    expect(lines.some((line) => line.includes("legacy reasoning"))).toBe(false);
    expect(lines.some((line) => line.includes("legacy-tool"))).toBe(false);
  });
});
