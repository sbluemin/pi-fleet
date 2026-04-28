import { keyHint } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { ANSI_RESET, PANEL_DIM_COLOR } from "@sbluemin/fleet-core/constants";

interface RequestEntry {
  label: string;
  text: string;
}

const COLLAPSED_MAX_LINES = 5;
const PREFIX = "╎";
const DIM = "\x1b[2m";

export function renderRequestPreview(
  entries: RequestEntry[],
  expanded: boolean,
  labelColor: string,
  width: number,
): string[] {
  if (entries.length < 1) return [];

  const contentLines = buildContentLines(entries, labelColor, width);
  if (contentLines.length < 1) return [];

  const hintLine = truncateLine(renderHintLine(expanded ? "접기" : "더보기"), width);
  if (expanded) return [...contentLines, hintLine];

  if (contentLines.length <= COLLAPSED_MAX_LINES) return contentLines;

  const collapsed = contentLines.slice(0, COLLAPSED_MAX_LINES);
  collapsed[collapsed.length - 1] = truncateLine(appendEllipsis(collapsed[collapsed.length - 1] ?? ""), width);
  return [...collapsed, hintLine];
}

function buildContentLines(entries: RequestEntry[], labelColor: string, width: number): string[] {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.label) lines.push(truncateLine(renderPrefixedLine(`${labelColor}▸ ${entry.label}${ANSI_RESET}`), width));

    const textLines = normalizeRequestLines(entry.text);
    const textIndent = entry.label ? "  " : "";
    for (const line of textLines) lines.push(truncateLine(renderPrefixedLine(`${textIndent}${line}`), width));
  }

  return lines;
}

function normalizeRequestLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").split("\n");
  return normalized.length > 0 ? normalized : [""];
}

function renderPrefixedLine(content: string): string {
  return `  ${DIM}${PREFIX}${ANSI_RESET} ${content}`;
}

function renderHintLine(label: string): string {
  return `  ${DIM}${PREFIX}${ANSI_RESET} ${PANEL_DIM_COLOR}${safeKeyHint(label)}${ANSI_RESET}`;
}

function truncateLine(line: string, width: number): string {
  return visibleWidth(line) > width ? truncateToWidth(line, width) : line;
}

function safeKeyHint(label: string): string {
  try {
    return keyHint("app.tools.expand", label);
  } catch {
    return `${DIM}⌃O ${label}${ANSI_RESET}`;
  }
}

function appendEllipsis(line: string): string {
  return line.endsWith("…") ? line : `${line}…`;
}
