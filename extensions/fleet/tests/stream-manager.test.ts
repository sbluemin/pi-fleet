import { beforeEach, describe, expect, it } from "vitest";

import {
  appendTextBlock,
  createRun,
  finalizeRun,
} from "../internal/streaming/stream-store.js";
import { createStreamWidgetManager } from "../internal/streaming/stream-manager.js";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
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

function renderWidgetLines(options: {
  toolsExpanded: boolean;
  runId: string;
  width?: number;
}): string[] {
  const globalKey = `__pi_test_stream_manager__${Date.now()}_${Math.random()}`;
  const widgetKey = "test-widget";
  const manager = createStreamWidgetManager(globalKey, widgetKey);
  let widgetFactory: ((tui: any, theme: any) => { render(width: number): string[] }) | undefined;

  const ctx = {
    ui: {
      getToolsExpanded: () => options.toolsExpanded,
      setWidget: (_key: string, widget: typeof widgetFactory | undefined) => {
        widgetFactory = widget;
      },
    },
  } as any;

  try {
    manager.register(ctx, "claude", options.runId);
    expect(widgetFactory).toBeTypeOf("function");
    return widgetFactory!({}, makeTheme())
      .render(options.width ?? 120)
      .map(stripAnsi);
  } finally {
    manager.clearAll();
    delete (globalThis as any)[globalKey];
  }
}

beforeEach(() => {
  (globalThis as any)["__pi_stream_store__"] = undefined;
});

describe("createStreamWidgetManager", () => {
  it("완료 후 compact 모드에서는 전체 출력이 최대 8줄로 축약된다", () => {
    const runId = createRun("claude", "conn", "compact done preview");
    appendTextBlock("claude", makeTextLines(10));
    finalizeRun("claude", "done");

    const lines = renderWidgetLines({ toolsExpanded: false, runId });

    expect(lines).toHaveLength(8);
    expect(lines[2]).toContain("Line 1");
    expect(lines[6]).toContain("Line 5");
    expect(lines[7]).toContain("··· 5 more lines");
  });

  it("완료 후 compact 모드에서도 8줄 이하 출력은 그대로 유지한다", () => {
    const runId = createRun("claude", "conn", "compact short preview");
    appendTextBlock("claude", makeTextLines(5));
    finalizeRun("claude", "done");

    const lines = renderWidgetLines({ toolsExpanded: false, runId });

    expect(lines).toHaveLength(7);
    expect(lines.some((line) => line.includes("more lines"))).toBe(false);
    expect(lines[6]).toContain("Line 5");
  });

  it("완료 후 expand 모드에서는 전체 출력이 유지된다", () => {
    const runId = createRun("claude", "conn", "expand done preview");
    appendTextBlock("claude", makeTextLines(10));
    finalizeRun("claude", "done");

    const lines = renderWidgetLines({ toolsExpanded: true, runId });

    expect(lines).toHaveLength(12);
    expect(lines.some((line) => line.includes("more lines"))).toBe(false);
    expect(lines[11]).toContain("Line 10");
  });

  it("스트리밍 중 compact 모드는 기존 tail 표시를 유지한다", () => {
    const runId = createRun("claude", "conn", "stream compact preview");
    appendTextBlock("claude", makeTextLines(10));

    const lines = renderWidgetLines({ toolsExpanded: false, runId });

    expect(lines).toHaveLength(7);
    expect(lines.some((line) => line.includes("more lines"))).toBe(false);
    expect(lines[2]).toContain("Line 6");
    expect(lines[6]).toContain("Line 10");
  });
});
