/**
 * shipyard/carrier/footer-renderer.ts — 에이전트 패널 footer 렌더링
 *
 * 패널 하단 상태 표시줄의 각 carrier 세그먼트를 렌더링합니다.
 * 순수 렌더 함수로 구성되어 있으며 상태에 대한 직접 의존이 없습니다.
 */

import {
  ANSI_RESET,
  PANEL_COLOR,
  PANEL_DIM_COLOR,
  SPINNER_FRAMES,
  SYM_INDICATOR,
} from "../../constants";
import {
  resolveCarrierColor,
  resolveCarrierDisplayName,
  resolveCarrierRgb,
} from "./framework.js";
import { waveText } from "../../internal/render/panel-renderer";
import type { AgentCol } from "../../internal/contracts.js";

/** renderFooterStatus에 필요한 최소 상태 */
interface FooterRenderInput {
  cols: AgentCol[];
  streaming: boolean;
  frame: number;
}

// ─── 헬퍼 ────────────────────────────────────────────────

function footerIcon(col: AgentCol, frame: number): string {
  const cliColor = resolveCarrierColor(col.cli) || PANEL_COLOR;
  const icon = col.status === "done"
    ? SYM_INDICATOR
    : col.status === "err"
      ? SYM_INDICATOR
      : col.status === "conn" || col.status === "stream"
        ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
        : "○";
  return `${cliColor}${icon}${ANSI_RESET}`;
}

// ─── 메인 렌더 함수 ─────────────────────────────────────

/**
 * footer 상태 문자열을 렌더링합니다.
 * 상태 객체를 파라미터로 받아 순수 함수로 동작합니다.
 */
export function renderFooterStatus(input: FooterRenderInput): string | undefined {
  const segments = input.cols.map((col) => {
    const footerCol = input.streaming ? col : { ...col, status: "wait" as const };
    const cliColor = resolveCarrierColor(col.cli) || PANEL_COLOR;
    const name = resolveCarrierDisplayName(col.cli);

    const isStreaming = footerCol.status === "conn" || footerCol.status === "stream";
    // 스트리밍 중: 아이콘 유지 + 이름에 파도 그라데이션
    return isStreaming
      ? `${footerIcon(footerCol, input.frame)} ${waveText(name, resolveCarrierRgb(col.cli), input.frame)}${ANSI_RESET}`
      : `${footerIcon(footerCol, input.frame)} ${cliColor}${name}${ANSI_RESET}`;
  });

  if (segments.length === 0) return undefined;
  return segments.join(`${PANEL_DIM_COLOR} │ ${ANSI_RESET}`);
}
