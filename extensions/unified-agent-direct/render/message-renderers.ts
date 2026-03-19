/**
 * unified-agent-direct — 기본 메시지 렌더러 팩토리
 *
 * 사용자 입력과 에이전트 응답에 대한 기본 렌더러를 생성합니다.
 * DirectModeConfig를 기반으로 스타일이 결정됩니다.
 */

import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import { ANSI_RESET, PREVIEW_LINES, SYM_INDICATOR, SYM_RESULT, SYM_THINKING } from "../constants";
import type { DirectModeConfig } from "../framework";

/**
 * 기본 사용자 입력 렌더러를 생성합니다.
 * 색상 바 + 입력 텍스트 표시
 */
export function createDefaultUserRenderer(config: DirectModeConfig) {
  return (message: any, _options: any, _theme: any) => {
    const color = config.color;
    const prefix = color ? `${color}▌${ANSI_RESET} ` : "";
    const content = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
        : "";
    return new Text(prefix + content, 0, 0);
  };
}

/**
 * 기본 응답 렌더러를 생성합니다.
 * 아이콘 + 이름 헤더, thinking 블록, toolCalls 블록, Markdown 본문,
 * 배경색 래퍼 포함
 */
export function createDefaultResponseRenderer(config: DirectModeConfig) {
  return (message: any, options: any, theme: any) => {
    const details = message.details as {
      cli?: string;
      sessionId?: string;
      error?: boolean;
      thinking?: string;
      toolCalls?: { title: string; status: string; rawOutput?: string }[];
    } | undefined;
    const isError = details?.error === true;
    const color = config.color;
    const bgAnsi = config.bgColor ?? "";
    const thinkingText = details?.thinking ?? "";
    const toolCalls = details?.toolCalls ?? [];

    // 아이콘 + 이름 헤더 (세션 정보 포함)
    const icon = isError ? theme.fg("error", SYM_INDICATOR) : theme.fg("success", SYM_INDICATOR);
    const nameStyled = color
      ? `${color}${theme.bold(config.displayName)}${ANSI_RESET}`
      : theme.fg("accent", theme.bold(config.displayName));
    const sessionSuffix = details?.sessionId
      ? theme.fg("dim", ` (session: ${details.sessionId})`)
      : "";
    const header = icon + " " + nameStyled + sessionSuffix;

    // 응답 텍스트 추출
    const contentText = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
        : "";

    const mdTheme = getMarkdownTheme();
    const inner = new Container();
    inner.addChild(new Text(header, 0, 0));
    inner.addChild(new Spacer(1));

    // thinking 블록
    if (thinkingText) {
      if (options.expanded) {
        inner.addChild(new Text(theme.fg("muted", `${SYM_THINKING} thinking`), 0, 0));
        inner.addChild(new Text(theme.fg("dim", thinkingText), 0, 0));
        inner.addChild(new Spacer(1));
      } else {
        const firstLine = thinkingText.split("\n").find((l: string) => l.trim()) ?? "";
        const preview = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
        inner.addChild(new Text(theme.fg("dim", `${SYM_THINKING} ${preview}`), 0, 0));
        inner.addChild(new Spacer(1));
      }
    }

    // toolCalls 블록
    if (toolCalls.length > 0) {
      if (options.expanded) {
        for (const tc of toolCalls) {
          // 각 도구마다 ⏺ 헤더
          const toolColor = tc.status === "error" ? "error" : "muted";
          inner.addChild(new Text(theme.fg(toolColor, `${SYM_INDICATOR} ${tc.title}`), 0, 0));
          // 완료/에러 시 ⎿ 결과 줄
          if (tc.status === "completed") {
            inner.addChild(new Text(theme.fg("dim", `  ${SYM_RESULT}  completed`), 0, 0));
          } else if (tc.status === "error") {
            inner.addChild(new Text(theme.fg("error", `  ${SYM_RESULT}  error`), 0, 0));
          }
        }
        inner.addChild(new Spacer(1));
      } else {
        const completed = toolCalls.filter((tc: any) => tc.status === "completed").length;
        inner.addChild(new Text(
          theme.fg("dim", `${SYM_INDICATOR} ${toolCalls.length} tools (${completed} completed)`),
          0, 0,
        ));
        inner.addChild(new Spacer(1));
      }
    }

    if (options.expanded) {
      inner.addChild(new Markdown(contentText, 0, 0, mdTheme));
    } else {
      const lines = contentText.split("\n");
      const preview = lines.slice(0, PREVIEW_LINES).join("\n");
      inner.addChild(new Markdown(preview, 0, 0, mdTheme));
      if (lines.length > PREVIEW_LINES) {
        inner.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), 0, 0));
      }
    }

    // 배경색이 없으면 그대로 반환
    if (!bgAnsi) return inner;

    // 배경색 래퍼
    return {
      render(width: number): string[] {
        return inner.render(width).map((line: string) => {
          const bgRestored = line.replaceAll("\x1b[0m", "\x1b[0m" + bgAnsi);
          const vw = visibleWidth(bgRestored);
          const pad = Math.max(0, width - vw);
          return bgAnsi + bgRestored + " ".repeat(pad) + ANSI_RESET;
        });
      },
      invalidate() { inner.invalidate(); },
    };
  };
}
