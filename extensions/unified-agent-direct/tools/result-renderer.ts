/**
 * unified-agent-direct/tools — 도구 실행 결과 렌더러
 *
 * 에이전트 도구 실행 결과를 채팅 메시지로 렌더링합니다.
 * block-renderer의 공유 로직을 사용하여 일관된 표시를 보장합니다.
 */

import { Container, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import {
  ANSI_RESET,
  SYM_INDICATOR,
} from "../constants";
import type { ColBlock } from "../render/panel-renderer";
import { renderBlocksToContainer, renderLegacyToContainer } from "../render/block-renderer";

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

    const inner = new Container();
    inner.addChild(new Text(header, 0, 0));
    inner.addChild(new Spacer(1));

    // blocks 기반 렌더링 (block-renderer 사용)
    if (blocks && blocks.length > 0) {
      renderBlocksToContainer(blocks, inner, theme);
    } else {
      // 레거시 폴백: blocks 미존재
      renderLegacyToContainer(contentText, toolCalls, thinkingText, inner, theme);
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
