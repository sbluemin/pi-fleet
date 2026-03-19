/**
 * unified-agent-direct — TUI 유틸리티 함수
 */

import { visibleWidth } from "@mariozechner/pi-tui";
import { ANSI_RE, ANSI_RESET, BORDER, SYM_INDICATOR, SYM_RESULT, SYM_THINKING } from "../constants";

/**
 * ANSI 코드 포함 문자열을 터미널 width에 맞게 잘라냅니다.
 * CJK 와이드 문자(폭 2)를 올바르게 처리합니다.
 */
export function fitToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
  if (visibleWidth(text) <= maxWidth) return text;
  const plain = text.replace(ANSI_RE, "");
  const ellipsisW = visibleWidth(ellipsis);
  const targetW = maxWidth - ellipsisW;
  if (targetW <= 0) return ellipsis.slice(0, maxWidth);
  // 문자별로 순회하며 visible width를 누적 (CJK 와이드 문자 대응)
  let w = 0;
  let cutIdx = 0;
  for (const ch of plain) {
    const cw = visibleWidth(ch);
    if (w + cw > targetW) break;
    w += cw;
    cutIdx += ch.length; // surrogate pair 대응
  }
  return plain.slice(0, cutIdx) + ellipsis + ANSI_RESET;
}

/**
 * 사각형 프레임의 상단/하단 보더 라인을 생성합니다.
 * 예: ╭──── label ────╮ (top) / ╰──── label ────╯ (bottom)
 */
export function makeBorderLine(
  label: string,
  width: number,
  color: string,
  position: "top" | "bottom",
): string {
  const left = position === "top" ? BORDER.topLeft : BORDER.bottomLeft;
  const right = position === "top" ? BORDER.topRight : BORDER.bottomRight;
  const h = BORDER.horizontal;
  const labelVW = visibleWidth(label);
  const fillLen = Math.max(0, width - 2 - labelVW);
  const leftLen = Math.floor(fillLen / 2);
  const rightLen = fillLen - leftLen;
  return color + left + h.repeat(leftLen) + ANSI_RESET + label + color + h.repeat(rightLen) + right + ANSI_RESET;
}

/**
 * 양쪽 사이드 보더 + 내부 패딩을 포함한 중간 라인을 생성합니다.
 * 예: │ content...padding │
 */
export function wrapWithSideBorder(
  content: string,
  width: number,
  color: string,
): string {
  const contentArea = Math.max(0, width - 4);
  const vw = visibleWidth(content);
  let inner: string;
  if (vw > contentArea) {
    inner = fitToWidth(content, contentArea);
    const truncVW = visibleWidth(inner);
    inner = inner + " ".repeat(Math.max(0, contentArea - truncVW));
  } else {
    inner = content + " ".repeat(Math.max(0, contentArea - vw));
  }
  return color + BORDER.vertical + ANSI_RESET + " " + inner + " " + color + BORDER.vertical + ANSI_RESET;
}

// ─── 스트리밍 미리보기 빌더 ──────────────────────────────

export interface StreamingState {
  thinking: string;
  toolCalls: { title: string; status: string; rawOutput?: string }[];
  response: string;
}

/**
 * thinking + 도구 호출 + 응답 텍스트를 통합하여
 * 스트리밍 미리보기 문자열을 생성합니다.
 *
 * 각 콜백에서 독립적으로 호출하면 모든 상태가 항상 반영됩니다.
 */
export function buildStreamingPreview(state: StreamingState): string {
  const sections: string[] = [];

  // thinking (응답이 시작되면 첫 줄만 축약)
  if (state.thinking) {
    if (state.response) {
      const firstLine = state.thinking.split("\n").find((l) => l.trim()) ?? "";
      const preview = firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
      sections.push(`${SYM_THINKING} ${preview}`);
    } else {
      sections.push(`${SYM_THINKING} thinking\n` + state.thinking);
    }
  }

  // 도구 호출 (항상 표시) — Claude Code 스타일 (⏺/⎿)
  if (state.toolCalls.length > 0) {
    const toolLines: string[] = [];
    for (const tc of state.toolCalls) {
      toolLines.push(`${SYM_INDICATOR} ${tc.title}`);
      if (tc.status === "completed") {
        toolLines.push(`  ${SYM_RESULT}  completed`);
      } else if (tc.status === "error") {
        toolLines.push(`  ${SYM_RESULT}  error`);
      }
    }
    sections.push(toolLines.join("\n"));
  }

  // 응답 텍스트
  if (state.response) {
    sections.push(state.response);
  }

  return sections.join("\n\n");
}
