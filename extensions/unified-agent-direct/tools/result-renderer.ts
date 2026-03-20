import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import {
  ANSI_RESET,
  PANEL_DIM_COLOR,
  SYM_INDICATOR,
  SYM_RESULT,
  SYM_THINKING,
  TOOLS_COLOR,
} from "../constants";
import type { ColBlock } from "../render/panel-renderer";

interface ToolResultDetails {
  sessionId?: string;
  error?: boolean;
  thinking?: string;
  toolCalls?: { title: string; status: string; rawOutput?: string }[];
  blocks?: ColBlock[];
}

function getContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { type: "text"; text: string } =>
        !!item && typeof item === "object" && (item as any).type === "text" && typeof (item as any).text === "string")
      .map((item) => item.text)
      .join("");
  }
  return "";
}

export function createToolResultRenderer(config: {
  displayName: string;
  color?: string;
  bgColor?: string;
}) {
  return (result: any, _options: any, theme: any) => {
    const details = result.details as ToolResultDetails | undefined;
    const isError = details?.error === true;
    const thinkingText = details?.thinking ?? "";
    const toolCalls = details?.toolCalls ?? [];
    const blocks = details?.blocks;
    const bgAnsi = config.bgColor ?? "";
    const contentText = getContentText(result.content);

    const icon = isError ? theme.fg("error", SYM_INDICATOR) : theme.fg("success", SYM_INDICATOR);
    const nameStyled = config.color
      ? `${config.color}${theme.bold(config.displayName)}${ANSI_RESET}`
      : theme.fg("accent", theme.bold(config.displayName));
    const sessionSuffix = details?.sessionId
      ? theme.fg("dim", ` (session: ${details.sessionId})`)
      : "";
    const header = `${icon} ${nameStyled}${sessionSuffix}`;

    const mdTheme = getMarkdownTheme();
    const inner = new Container();
    inner.addChild(new Text(header, 0, 0));
    inner.addChild(new Spacer(1));

    if (thinkingText) {
      inner.addChild(new Text(theme.fg("muted", `${SYM_THINKING} thinking`), 0, 0));
      inner.addChild(new Text(theme.fg("dim", thinkingText), 0, 0));
      inner.addChild(new Spacer(1));
    }

    if (blocks && blocks.length > 0) {
      const MAX_RESULT_LINES = 4;

      for (const block of blocks) {
        if (block.type === "text") {
          const trimmed = block.text.replace(/^\n+/, "");
          if (!trimmed) continue;
          const formatted = trimmed
            .split("\n")
            .map((line, index) => (index === 0 ? `${SYM_INDICATOR} ${line}` : `  ${line}`))
            .join("\n");
          inner.addChild(new Markdown(formatted, 0, 0, mdTheme));
          continue;
        }

        const isToolError = block.status === "failed" || block.status === "error";
        const titleText = `${SYM_INDICATOR} ${block.title}`;
        inner.addChild(new Text(
          isToolError
            ? theme.fg("error", titleText)
            : `${TOOLS_COLOR}${titleText}${ANSI_RESET}`,
          0, 0,
        ));

        const statusText = block.rawOutput?.trim()
          ? block.rawOutput
          : (block.status === "completed" || block.status === "failed" || block.status === "error"
            ? block.status
            : "");
        if (!statusText) continue;

        const rawLines = statusText.split("\n");
        const displayLines = rawLines.length > MAX_RESULT_LINES
          ? rawLines.slice(0, MAX_RESULT_LINES - 1)
          : rawLines;
        const foldedCount = rawLines.length > MAX_RESULT_LINES
          ? rawLines.length - (MAX_RESULT_LINES - 1)
          : 0;

        for (let i = 0; i < displayLines.length; i++) {
          const prefix = i === 0 ? `  ${SYM_RESULT}  ` : "     ";
          inner.addChild(new Text(
            isToolError
              ? theme.fg("error", `${prefix}${displayLines[i]}`)
              : `${PANEL_DIM_COLOR}${prefix}${displayLines[i]}${ANSI_RESET}`,
            0, 0,
          ));
        }

        if (foldedCount > 0) {
          inner.addChild(new Text(
            `${PANEL_DIM_COLOR}     … +${foldedCount} lines${ANSI_RESET}`,
            0, 0,
          ));
        }
      }
    } else {
      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const toolColor = toolCall.status === "error" ? "error" : "muted";
          inner.addChild(new Text(theme.fg(toolColor, `${SYM_INDICATOR} ${toolCall.title}`), 0, 0));
          if (toolCall.status === "completed") {
            inner.addChild(new Text(theme.fg("dim", `  ${SYM_RESULT}  completed`), 0, 0));
          } else if (toolCall.status === "error") {
            inner.addChild(new Text(theme.fg("error", `  ${SYM_RESULT}  error`), 0, 0));
          }
        }
        inner.addChild(new Spacer(1));
      }

      inner.addChild(new Markdown(contentText, 0, 0, mdTheme));
    }

    if (!bgAnsi) return inner;

    return {
      render(width: number): string[] {
        return inner.render(width).map((line: string) => {
          const bgRestored = line.replaceAll("\x1b[0m", "\x1b[0m" + bgAnsi);
          const vw = visibleWidth(bgRestored);
          const pad = Math.max(0, width - vw);
          return bgAnsi + bgRestored + " ".repeat(pad) + ANSI_RESET;
        });
      },
      invalidate() {
        inner.invalidate();
      },
    };
  };
}
