/**
 * unified-agent-direct — 기본 메시지 렌더러 팩토리
 *
 * 사용자 입력과 에이전트 응답에 대한 기본 렌더러를 생성합니다.
 * DirectModeConfig를 기반으로 스타일이 결정됩니다.
 */

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
import type { DirectModeConfig } from "../framework";
import type { ColBlock } from "./panel-renderer";

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
  return (message: any, _options: any, theme: any) => {
    const details = message.details as {
      cli?: string;
      sessionId?: string;
      error?: boolean;
      thinking?: string;
      toolCalls?: { title: string; status: string; rawOutput?: string }[];
      blocks?: ColBlock[];
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

    // thinking 블록 (항상 full 표시)
    if (thinkingText) {
      inner.addChild(new Text(theme.fg("muted", `${SYM_THINKING} thinking`), 0, 0));
      inner.addChild(new Text(theme.fg("dim", thinkingText), 0, 0));
      inner.addChild(new Spacer(1));
    }

    // blocks 기반 렌더링 (패널 렌더러와 동일한 프리티 표기)
    const blocks = details?.blocks;

    if (blocks && blocks.length > 0) {
      // ── blocks 존재: 이벤트 발생 순서대로 심볼/색상 렌더링 ──
      const MAX_RESULT_LINES = 4;

      for (const block of blocks) {
        if (block.type === "text") {
          // 응답 텍스트: 첫 줄 ⏺ + 이후 줄 들여쓰기
          const trimmed = block.text.replace(/^\n+/, "");
          if (!trimmed) continue;
          const textLines = trimmed.split("\n");
          const formatted = textLines.map((line: string, i: number) =>
            i === 0 ? `${SYM_INDICATOR} ${line}` : `  ${line}`,
          ).join("\n");
          inner.addChild(new Markdown(formatted, 0, 0, mdTheme));
        } else {
          // 도구 블록: ⏺ 타이틀 (TOOLS_COLOR) + ⎿ rawOutput (dim)
          const isToolError = block.status === "failed" || block.status === "error";
          const titleColor = isToolError ? "error" : undefined;
          const titleText = `${SYM_INDICATOR} ${block.title}`;
          inner.addChild(new Text(
            titleColor
              ? theme.fg(titleColor, titleText)
              : `${TOOLS_COLOR}${titleText}${ANSI_RESET}`,
            0, 0,
          ));

          // rawOutput 또는 status 표시
          const statusText = block.rawOutput?.trim()
            ? block.rawOutput
            : (block.status === "completed" || block.status === "failed" || block.status === "error"
              ? block.status
              : "");
          if (statusText) {
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
        }
      }
    } else {
      // ── 폴백: blocks 미존재 (이전 히스토리 메시지) → 기존 toolCalls + Markdown ──
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const toolColor = tc.status === "error" ? "error" : "muted";
          inner.addChild(new Text(theme.fg(toolColor, `${SYM_INDICATOR} ${tc.title}`), 0, 0));
          if (tc.status === "completed") {
            inner.addChild(new Text(theme.fg("dim", `  ${SYM_RESULT}  completed`), 0, 0));
          } else if (tc.status === "error") {
            inner.addChild(new Text(theme.fg("error", `  ${SYM_RESULT}  error`), 0, 0));
          }
        }
        inner.addChild(new Spacer(1));
      }

      inner.addChild(new Markdown(contentText, 0, 0, mdTheme));
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
