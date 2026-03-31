/**
 * render/footer-renderer.ts — 에이전트 패널 footer 렌더링
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
} from "../../carrier/framework.js";
import { waveText } from "./panel-renderer";
import type { AgentCol } from "../contracts.js";

/** 캐리어별(carrierId) 모델/추론 설정 (footer 표시용) */
interface FooterModelInfo {
  model: string;
  effort?: string;
}

/** 서비스 상태 토큰 렌더링 함수 시그니처 (의존 역전) */
type ServiceStatusRenderer = (carrierId: string) => string | undefined;

/** renderFooterStatus에 필요한 최소 상태 */
export interface FooterRenderInput {
  cols: AgentCol[];
  streaming: boolean;
  frame: number;
  modelConfig: Record<string, FooterModelInfo>;
  /** 서비스 상태 토큰 렌더러 (호출자가 주입) */
  renderServiceStatus?: ServiceStatusRenderer;
}

// ─── 헬퍼 ────────────────────────────────────────────────

export function footerIcon(col: AgentCol, frame: number): string {
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

export function footerDetail(col: AgentCol): string {
  if (col.status === "conn") return " connecting";
  if (col.status === "done") return " done";
  if (col.status === "err") return " error";
  if (col.status === "wait") return " idle";
  if (col.status !== "stream") return "";

  const parts: string[] = [];
  if (col.toolCalls.length > 0) parts.push(`${col.toolCalls.length}T`);

  const lineCount = col.text.trim() ? col.text.split("\n").length : 0;
  if (lineCount > 0) parts.push(`${lineCount}L`);

  if (parts.length === 0 && col.thinking.trim()) {
    return " thinking";
  }
  if (parts.length === 0) {
    return " running";
  }
  return ` ${parts.join("·")}`;
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
    const detail = footerDetail(footerCol);
    const serviceStatus = input.renderServiceStatus?.(col.cli);

    // 모델/effort 정보
    const sel = input.modelConfig[col.cli];
    let modelSuffix = "";
    if (sel?.model) {
      const effortText = sel.effort && sel.effort !== "none"
        ? ` · ${sel.effort.charAt(0).toUpperCase()}${sel.effort.slice(1)}`
        : "";
      modelSuffix = `${PANEL_DIM_COLOR} (${sel.model}${effortText})${ANSI_RESET}`;
    }

    const isStreaming = footerCol.status === "conn" || footerCol.status === "stream";
    // 스트리밍 중: 아이콘 유지 + 이름에 파도 그라데이션
    const namePrefix = isStreaming
      ? `${footerIcon(footerCol, input.frame)} ${waveText(name, resolveCarrierRgb(col.cli), input.frame)}${ANSI_RESET}`
      : `${footerIcon(footerCol, input.frame)} ${cliColor}${name}${ANSI_RESET}`;

    return `${namePrefix}${serviceStatus ?? ""}${modelSuffix}${
      detail ? `${PANEL_DIM_COLOR}${detail}${ANSI_RESET}` : ""
    }`;
  });

  if (segments.length === 0) return undefined;
  return segments.join(`${PANEL_DIM_COLOR} │ ${ANSI_RESET}`);
}
