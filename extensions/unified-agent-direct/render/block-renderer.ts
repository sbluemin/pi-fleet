/**
 * unified-agent-direct — 블록 렌더러 (공유 렌더링 로직)
 *
 * ColBlock[]를 렌더링 가능한 형태로 변환합니다.
 * panel-renderer, streaming-widget, message-renderers, result-renderer의
 * 4중 중복 블록 렌더링 로직을 단일 모듈로 통합합니다.
 *
 * 두 가지 출력 모드를 제공합니다:
 * - renderBlockLines(): 라인 기반 (패널/위젯용)
 * - renderBlocksToContainer(): TUI 컴포넌트 기반 (채팅 메시지/도구 결과용)
 */

import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { ColBlock } from "./panel-renderer.js";
import {
  ANSI_RESET,
  PANEL_DIM_COLOR,
  THINKING_COLOR,
  TOOLS_COLOR,
  SYM_INDICATOR,
  SYM_RESULT,
  SYM_THINKING,
} from "../constants.js";

// ─── 공통 상수 ───────────────────────────────────────────

/** 도구 결과 줄 접기 최대 줄 수 */
export const MAX_RESULT_LINES = 4;

/** 에러 색상 (ANSI) */
const ERROR_COLOR = "\x1b[38;2;255;80;80m";

// ─── 라인 기반 렌더링 (패널/위젯용) ──────────────────────

/** 렌더링된 블록 라인의 의미적 타입 */
export type BlockLineType =
  | "thought"
  | "text"
  | "tool-title"
  | "tool-result"
  | "tool-error"
  | "fold";

/** 블록에서 파생된 포맷팅 라인 */
export interface BlockLine {
  type: BlockLineType;
  /** 프리픽스(심볼/들여쓰기) 포함된 포맷팅 텍스트 */
  text: string;
}

/**
 * ColBlock[]를 포맷팅된 라인 목록으로 변환합니다.
 * 패널 렌더러와 스트리밍 위젯에서 사용됩니다.
 *
 * 라인에는 심볼 프리픽스와 들여쓰기가 포함되지만
 * 색상은 적용되지 않습니다. 색상은 소비자가 `type` 기반으로 적용합니다.
 */
export function renderBlockLines(
  blocks: readonly ColBlock[],
  options?: { maxResultLines?: number },
): BlockLine[] {
  const maxRL = options?.maxResultLines ?? MAX_RESULT_LINES;
  const lines: BlockLine[] = [];

  for (const block of blocks) {
    if (block.type === "thought") {
      const trimmed = block.text.replace(/^\n+/, "");
      if (!trimmed) continue;
      trimmed.split("\n").forEach((line, i) => {
        lines.push({
          type: "thought",
          text: i === 0 ? `${SYM_THINKING} ${line}` : `  ${line}`,
        });
      });
    } else if (block.type === "text") {
      const trimmed = block.text.replace(/^\n+/, "");
      if (!trimmed) continue;
      trimmed.split("\n").forEach((line, i) => {
        lines.push({
          type: "text",
          text: i === 0 ? `${SYM_INDICATOR} ${line}` : `  ${line}`,
        });
      });
    } else {
      // tool 블록
      const isError = block.status === "failed" || block.status === "error";
      const isFinished = block.status === "completed" || block.status === "failed" || block.status === "error";
      lines.push({
        type: isError ? "tool-error" : "tool-title",
        text: `${SYM_INDICATOR} ${block.title}`,
      });

      // cli-renderer.ts와 동일: completed/failed/error 상태에서만 결과 표시
      if (isFinished) {
        const statusText = block.rawOutput?.trim() ? block.rawOutput : block.status;
        appendToolResultLines(statusText, isError, maxRL, lines);
      }
    }
  }

  return lines;
}

/** 도구 결과를 접기 로직과 함께 라인 배열에 추가 */
function appendToolResultLines(
  text: string,
  isError: boolean,
  maxRL: number,
  lines: BlockLine[],
): void {
  const rawLines = text.split("\n");
  const displayLines = rawLines.length > maxRL
    ? rawLines.slice(0, maxRL - 1)
    : rawLines;
  const foldedCount = rawLines.length > maxRL
    ? rawLines.length - (maxRL - 1)
    : 0;
  const type: BlockLineType = isError ? "tool-error" : "tool-result";

  displayLines.forEach((line, i) => {
    lines.push({
      type,
      text: i === 0 ? `  ${SYM_RESULT}  ${line}` : `     ${line}`,
    });
  });

  if (foldedCount > 0) {
    lines.push({
      type: "fold",
      text: `     … +${foldedCount} lines`,
    });
  }
}

// ─── ANSI 색상 매핑 (패널 렌더러용) ──────────────────────

/** BlockLineType에 대응하는 ANSI 색상 프리픽스를 반환합니다. */
export function blockLineAnsiColor(type: BlockLineType): string {
  switch (type) {
    case "thought":
      return THINKING_COLOR;
    case "tool-title":
      return TOOLS_COLOR;
    case "tool-result":
    case "fold":
      return PANEL_DIM_COLOR;
    case "tool-error":
      return ERROR_COLOR;
    case "text":
    default:
      return "";
  }
}

// ─── TUI 컴포넌트 렌더링 (채팅 메시지/도구 결과용) ──────

/**
 * blocks를 TUI 컴포넌트로 변환하여 Container에 추가합니다.
 * message-renderers와 result-renderer에서 공통 사용됩니다.
 *
 * @param blocks - 렌더링할 블록 배열
 * @param container - 자식 컴포넌트를 추가할 Container
 * @param theme - TUI 테마 객체 (fg, bold 등)
 */
export function renderBlocksToContainer(
  blocks: readonly ColBlock[],
  container: Container,
  theme: any,
): void {
  const mdTheme = getMarkdownTheme();
  const maxRL = MAX_RESULT_LINES;

  for (const block of blocks) {
    if (block.type === "thought") {
      const trimmed = block.text.replace(/^\n+/, "");
      if (!trimmed) continue;
      const formatted = trimmed
        .split("\n")
        .map((line, i) => (i === 0 ? `${SYM_THINKING} ${line}` : `  ${line}`))
        .join("\n");
      container.addChild(new Text(theme.fg("dim", formatted), 0, 0));
    } else if (block.type === "text") {
      const trimmed = block.text.replace(/^\n+/, "");
      if (!trimmed) continue;
      const formatted = trimmed
        .split("\n")
        .map((line, i) => (i === 0 ? `${SYM_INDICATOR} ${line}` : `  ${line}`))
        .join("\n");
      container.addChild(new Markdown(formatted, 0, 0, mdTheme));
    } else {
      // tool 블록
      const isError = block.status === "failed" || block.status === "error";
      const isFinished = block.status === "completed" || block.status === "failed" || block.status === "error";
      const titleText = `${SYM_INDICATOR} ${block.title}`;
      container.addChild(new Text(
        isError
          ? theme.fg("error", titleText)
          : `${TOOLS_COLOR}${titleText}${ANSI_RESET}`,
        0, 0,
      ));

      // cli-renderer.ts와 동일: completed/failed/error 상태에서만 결과 표시
      if (isFinished) {
        const statusText = block.rawOutput?.trim() ? block.rawOutput : block.status;
        appendToolResultComponents(statusText, isError, maxRL, container, theme);
      }
    }
  }
}

/** 도구 결과를 접기 로직과 함께 TUI 컴포넌트로 Container에 추가 */
function appendToolResultComponents(
  text: string,
  isError: boolean,
  maxRL: number,
  container: Container,
  theme: any,
): void {
  const rawLines = text.split("\n");
  const displayLines = rawLines.length > maxRL
    ? rawLines.slice(0, maxRL - 1)
    : rawLines;
  const foldedCount = rawLines.length > maxRL
    ? rawLines.length - (maxRL - 1)
    : 0;

  for (let i = 0; i < displayLines.length; i++) {
    const prefix = i === 0 ? `  ${SYM_RESULT}  ` : "     ";
    container.addChild(new Text(
      isError
        ? theme.fg("error", `${prefix}${displayLines[i]}`)
        : `${PANEL_DIM_COLOR}${prefix}${displayLines[i]}${ANSI_RESET}`,
      0, 0,
    ));
  }

  if (foldedCount > 0) {
    container.addChild(new Text(
      `${PANEL_DIM_COLOR}     … +${foldedCount} lines${ANSI_RESET}`,
      0, 0,
    ));
  }
}

// ─── 레거시 폴백 렌더링 (blocks 미존재 시) ────────────────

/**
 * blocks가 없는 레거시 메시지를 TUI 컴포넌트로 렌더링합니다.
 * toolCalls + contentText 기반의 이전 형식 메시지 호환용입니다.
 */
export function renderLegacyToContainer(
  contentText: string,
  toolCalls: { title: string; status: string; rawOutput?: string }[],
  thinkingText: string,
  container: Container,
  theme: any,
): void {
  const mdTheme = getMarkdownTheme();

  // thinking 폴백
  if (thinkingText) {
    container.addChild(new Text(theme.fg("muted", `${SYM_THINKING} thinking`), 0, 0));
    container.addChild(new Text(theme.fg("dim", thinkingText), 0, 0));
    container.addChild(new Spacer(1));
  }

  // toolCalls 폴백
  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      const toolColor = tc.status === "error" ? "error" : "muted";
      container.addChild(new Text(theme.fg(toolColor, `${SYM_INDICATOR} ${tc.title}`), 0, 0));
      if (tc.status === "completed") {
        container.addChild(new Text(theme.fg("dim", `  ${SYM_RESULT}  completed`), 0, 0));
      } else if (tc.status === "error") {
        container.addChild(new Text(theme.fg("error", `  ${SYM_RESULT}  error`), 0, 0));
      }
    }
    container.addChild(new Spacer(1));
  }

  container.addChild(new Markdown(contentText, 0, 0, mdTheme));
}
