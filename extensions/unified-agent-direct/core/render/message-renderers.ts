/**
 * unified-agent-direct — 메시지 렌더러 팩토리 (통합)
 *
 * 사용자 입력, 에이전트 응답, 도구 결과를 렌더링합니다.
 * Direct Mode의 채팅 메시지와 PI Tool의 결과 렌더링을 단일 모듈로 통합합니다.
 *
 * 내부적으로 공통 팩토리(renderAgentResult)를 공유하며,
 * 소비자별 입력 인터페이스에 맞는 어댑터를 제공합니다.
 */

import { Container, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import {
  ANSI_RESET,
  SYM_INDICATOR,
} from "../../constants";
import type { ColBlock } from "../contracts.js";

/** 렌더러에 필요한 최소 설정 (framework.DirectModeConfig에서 추출) */
export interface AgentRenderConfig {
  /** 표시 이름 */
  displayName: string;
  /** 에이전트 패널 프레임 색상 (ANSI) */
  color: string;
  /** 응답 배경색 (ANSI, 선택) */
  bgColor?: string;
}
import { renderBlocksToContainer, renderLegacyToContainer } from "./block-renderer";

// ─── 공통 내부 헬퍼 ─────────────────────────────────────

/** 에이전트 결과 details의 공통 타입 */
interface AgentResultDetails {
  sessionId?: string;
  error?: boolean;
  thinking?: string;
  toolCalls?: { title: string; status: string; rawOutput?: string }[];
  blocks?: ColBlock[];
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
 * Direct Mode 응답 렌더러와 Tool 결과 렌더러가 공유합니다.
 */
function renderAgentResult(
  config: { displayName: string; color?: string; bgColor?: string },
  contentText: string,
  details: AgentResultDetails | undefined,
  theme: any,
): any {
  const isError = details?.error === true;
  const bgAnsi = config.bgColor ?? "";
  const thinkingText = details?.thinking ?? "";
  const toolCalls = details?.toolCalls ?? [];
  const blocks = details?.blocks;

  // 아이콘 + 이름 헤더 (세션 정보 포함)
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

// ─── 공개 렌더러 팩토리 ─────────────────────────────────

/**
 * 기본 사용자 입력 렌더러를 생성합니다.
 * 색상 바 + 입력 텍스트 표시
 */
export function createDefaultUserRenderer(config: AgentRenderConfig) {
  return (message: any, _options: any, _theme: any) => {
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
  return (message: any, _options: any, theme: any) => {
    const details = message.details as AgentResultDetails | undefined;
    const contentText = extractContentText(message.content);
    return renderAgentResult(
      { displayName: config.displayName, color: config.color, bgColor: config.bgColor },
      contentText,
      details,
      theme,
    );
  };
}

/**
 * PI 도구 실행 결과 렌더러를 생성합니다.
 * 공통 팩토리(renderAgentResult)를 사용하여
 * Direct Mode 응답과 동일한 렌더링을 보장합니다.
 */
export function createToolResultRenderer(config: {
  displayName: string;
  color?: string;
  bgColor?: string;
}) {
  return (result: any, _options: any, theme: any) => {
    const details = result.details as AgentResultDetails | undefined;
    const contentText = extractContentText(result.content);
    return renderAgentResult(config, contentText, details, theme);
  };
}
