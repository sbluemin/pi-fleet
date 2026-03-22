/**
 * unified-agent-direct — 기본 메시지 렌더러 팩토리
 *
 * 사용자 입력과 에이전트 응답에 대한 기본 렌더러를 생성합니다.
 * DirectModeConfig를 기반으로 스타일이 결정됩니다.
 */

import { Container, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import {
  ANSI_RESET,
  SYM_INDICATOR,
} from "../constants";
import type { DirectModeConfig } from "../framework";
import type { ColBlock } from "./panel-renderer";
import { renderBlocksToContainer, renderLegacyToContainer } from "./block-renderer";

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
    const blocks = details?.blocks;

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

    const inner = new Container();
    inner.addChild(new Text(header, 0, 0));
    inner.addChild(new Spacer(1));

    // blocks 기반 렌더링 (block-renderer 사용)
    if (blocks && blocks.length > 0) {
      renderBlocksToContainer(blocks, inner, theme);
    } else {
      // 레거시 폴백: blocks 미존재 (이전 히스토리 메시지)
      renderLegacyToContainer(contentText, toolCalls, thinkingText, inner, theme);
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
