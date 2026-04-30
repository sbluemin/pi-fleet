/**
 * fleet — 메시지 렌더러 팩토리 (통합)
 *
 * 사용자 입력, 에이전트 응답, 도구 결과를 렌더링합니다.
 * Carrier의 채팅 메시지와 PI Tool의 결과 렌더링을 단일 모듈로 통합합니다.
 *
 * 내부적으로 공통 팩토리(renderAgentResult)를 공유하며,
 * 소비자별 입력 인터페이스에 맞는 어댑터를 제공합니다.
 */

import { Container, Spacer, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  ANSI_RESET,
  PANEL_DIM_COLOR,
  SYM_INDICATOR,
  TOOLS_COLOR,
} from "@sbluemin/fleet-core/constants";

import { renderBlockLines, blockLineToAnsi, renderBlocksToContainer, renderLegacyToContainer } from "./block-renderer.js";
import type { BlockLine } from "./block-renderer.js";
import type { ColBlock } from "../../agent/ui/panel/types.js";

/** 렌더러에 필요한 최소 설정 (framework.CarrierConfig에서 추출) */
interface AgentRenderConfig {
  /** 표시 이름 */
  displayName: string;
  /** 에이전트 패널 프레임 색상 (ANSI) */
  color: string;
  /** 응답 배경색 (ANSI, 선택) */
  bgColor?: string;
}

// ─── 공통 내부 헬퍼 ─────────────────────────────────────

/** 에이전트 결과 details의 공통 타입 */
interface AgentResultDetails {
  sessionId?: string;
  error?: boolean;
  thinking?: string;
  toolCalls?: { title: string; status: string }[];
  blocks?: ColBlock[];
}

interface AgentResultRenderOptions {
  expanded?: boolean;
}

type RenderTheme = Pick<Theme, "fg" | "bold">;

interface RenderComponent {
  render(width: number): string[];
  invalidate(): void;
}

interface CompactOverflowTheme {
  fg(token: string, text: string): string;
}

const COMPACT_MAX_LINES = 8;
const COMPACT_OVERFLOW_PREFIX = "··· ";

/**
 * 기본 사용자 입력 렌더러를 생성합니다.
 * 색상 바 + 입력 텍스트 표시
 */
export function createDefaultUserRenderer(config: AgentRenderConfig) {
  return (message: any, _options: unknown, _theme: RenderTheme) => {
    const color = config.color;
    const prefix = color ? `${color}▌${ANSI_RESET} ` : "";
    const content = extractContentText(message.content);
    return new Text(prefix + content, 0, 0);
  };
}

/**
 * 기본 응답 렌더러를 생성합니다.
 * 아이콘 + 이름 헤더, thinking 블록, toolCalls 블록, Markdown 본문,
 * 배경색 래퍼 포함
 */
export function createDefaultResponseRenderer(config: AgentRenderConfig) {
  return (message: any, options: AgentResultRenderOptions, theme: RenderTheme) => {
    const details = message.details as AgentResultDetails | undefined;
    const contentText = extractContentText(message.content);
    return renderAgentResult(
      { displayName: config.displayName, color: config.color, bgColor: config.bgColor },
      contentText,
      details,
      options,
      theme,
    );
  };
}

function formatCarrierLabel(displayName: string): string {
  return `Carrier ${displayName}`;
}

function clampCompletedCompactLines(
  lines: readonly string[],
  theme: CompactOverflowTheme,
): string[] {
  if (lines.length <= COMPACT_MAX_LINES) return [...lines];

  const visibleCount = COMPACT_MAX_LINES - 1;
  const hiddenCount = lines.length - visibleCount;
  return [
    ...lines.slice(0, visibleCount),
    theme.fg("dim", `${COMPACT_OVERFLOW_PREFIX}${hiddenCount} more lines`),
  ];
}

/** content 필드에서 텍스트를 추출하는 헬퍼 */
function extractContentText(content: unknown): string {
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

/**
 * 에이전트 결과를 렌더링하는 공통 팩토리.
 * Carrier 응답 렌더러와 Tool 결과 렌더러가 공유합니다.
 */
function renderAgentResult(
  config: { displayName: string; color?: string; bgColor?: string },
  contentText: string,
  details: AgentResultDetails | undefined,
  options: AgentResultRenderOptions,
  theme: RenderTheme,
): RenderComponent {
  const isError = details?.error === true;
  const bgAnsi = config.bgColor ?? "";
  const thinkingText = details?.thinking ?? "";
  const toolCalls = details?.toolCalls ?? [];
  const blocks = details?.blocks;
  const expanded = options.expanded === true;

  // 아이콘 + 이름 헤더 (세션 정보 포함)
  const icon = isError ? theme.fg("error", SYM_INDICATOR) : theme.fg("success", SYM_INDICATOR);
  const carrierLabel = formatCarrierLabel(config.displayName);
  const nameStyled = config.color
    ? `${config.color}${theme.bold(carrierLabel)}${ANSI_RESET}`
    : theme.fg("accent", theme.bold(carrierLabel));
  const sessionSuffix = details?.sessionId
    ? theme.fg("dim", ` (session: ${details.sessionId})`)
    : "";
  const header = `${icon} ${nameStyled}${sessionSuffix}`;

  if (!expanded) {
    return createCompactResultComponent({
      bgAnsi,
      blocks,
      contentText,
      header,
      theme,
      thinkingText,
      toolCalls,
    });
  }

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
}

function createCompactResultComponent(args: {
  header: string;
  bgAnsi: string;
  blocks?: ColBlock[];
  contentText: string;
  thinkingText: string;
  toolCalls: { title: string; status: string }[];
  theme: RenderTheme;
}): RenderComponent {
  const { bgAnsi, blocks, contentText, header, theme, thinkingText, toolCalls } = args;

  return {
    render(width: number): string[] {
      const rawLines = [header, "", ...renderCompactBodyLines(blocks, contentText, thinkingText, toolCalls, theme)];
      const compactLines = clampCompletedCompactLines(rawLines, theme);
      const truncated = compactLines.map((line) =>
        visibleWidth(line) > width ? truncateToWidth(line, width) : line,
      );
      return bgAnsi ? applyBackgroundAnsi(truncated, width, bgAnsi) : truncated;
    },
    invalidate() {},
  };
}

function renderCompactBodyLines(
  blocks: readonly ColBlock[] | undefined,
  contentText: string,
  thinkingText: string,
  toolCalls: readonly { title: string; status: string }[],
  theme: RenderTheme,
): string[] {
  const sourceBlocks = blocks ?? buildLegacyBlocks(contentText, thinkingText, toolCalls);
  const visibleBlocks = sourceBlocks.filter((block) => block.type !== "tool" && block.type !== "thought");

  return renderBlockLines(visibleBlocks).map((line: BlockLine) => {
    // suffix가 있으면 blockLineToAnsi로 타이틀/상태 색상 분리 적용
    if (line.suffix) return blockLineToAnsi(line);
    if (line.type === "tool-error") {
      return theme.fg("error", line.text);
    }
    if (line.type === "tool-title") {
      return `${TOOLS_COLOR}${line.text}${ANSI_RESET}`;
    }
    if (line.type === "tool-result" || line.type === "fold") {
      return `${PANEL_DIM_COLOR}${line.text}${ANSI_RESET}`;
    }
    if (line.type === "thought") {
      return theme.fg("dim", line.text);
    }
    return line.text;
  });
}

function buildLegacyBlocks(
  contentText: string,
  thinkingText: string,
  toolCalls: readonly { title: string; status: string }[],
): ColBlock[] {
  const blocks: ColBlock[] = [];
  if (thinkingText) {
    blocks.push({ type: "thought", text: thinkingText });
  }
  for (const toolCall of toolCalls) {
    blocks.push({ type: "tool", title: toolCall.title, status: toolCall.status });
  }
  if (contentText) {
    blocks.push({ type: "text", text: contentText });
  }
  return blocks;
}

function applyBackgroundAnsi(lines: readonly string[], width: number, bgAnsi: string): string[] {
  return lines.map((line) => {
    const restored = line.replaceAll("\x1b[0m", "\x1b[0m" + bgAnsi);
    const vw = visibleWidth(restored);
    const pad = Math.max(0, width - vw);
    return bgAnsi + restored + " ".repeat(pad) + ANSI_RESET;
  });
}
