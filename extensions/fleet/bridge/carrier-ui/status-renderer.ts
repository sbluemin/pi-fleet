/**
 * shipyard/carrier/status-renderer.ts — carrier 상태 렌더링
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
} from "../../constants.js";
import {
  resolveCarrierColor,
  resolveCarrierDisplayName,
  resolveCarrierRgb,
  isSortieCarrierEnabled,
  isSquadronCarrierEnabled,
} from "../../shipyard/carrier/framework.js";
import { getConfiguredTaskForceBackends } from "../../shipyard/store.js";
import { waveText } from "../render/panel-renderer.js";
import type { AgentCol } from "../panel/types.js";

/** renderCarrierStatus에 필요한 최소 상태 */
interface CarrierStatusRenderInput {
  cols: AgentCol[];
  streaming: boolean;
  frame: number;
}

/** sortie 비활성 캐리어용 dim 색상 */
const DISABLED_COLOR = "\x1b[38;2;100;100;100m";

/** TF 구성 완료 배지 색상 */
const TF_BADGE_COLOR = "\x1b[38;2;100;180;255m";

/** Squadron 편제 배지 색상 (보라 계열 — status-overlay와 동일) */
const SQ_BADGE_COLOR = "\x1b[38;2;180;140;255m";

// ─── 메인 렌더 함수 ─────────────────────────────────────

/**
 * carrier 상태 문자열을 렌더링합니다.
 * 상태 객체를 파라미터로 받아 순수 함수로 동작합니다.
 */
export function renderCarrierStatus(input: CarrierStatusRenderInput): string | undefined {
  const segments = input.cols.map((col) => {
    const footerCol = input.streaming ? col : { ...col, status: "wait" as const };
    const disabled = !isSortieCarrierEnabled(col.cli);
    const name = resolveCarrierDisplayName(col.cli);
    const taskForceBackendCount = getConfiguredTaskForceBackends(col.cli).length;
    const tfBadgeColor = disabled ? DISABLED_COLOR : TF_BADGE_COLOR;
    const sqBadgeColor = disabled ? DISABLED_COLOR : SQ_BADGE_COLOR;
    const tfBadge = taskForceBackendCount >= 2
      ? ` ${tfBadgeColor}[TF:${taskForceBackendCount}]${ANSI_RESET}`
      : "";
    const sqBadge = isSquadronCarrierEnabled(col.cli)
      ? ` ${sqBadgeColor}[SQ]${ANSI_RESET}`
      : "";
    const badges = `${tfBadge}${sqBadge}`;

    // sortie 비활성 캐리어: 아이콘·이름·배지 모두 dim 처리
    if (disabled) {
      return `${statusIcon(footerCol, input.frame, true)} ${DISABLED_COLOR}${name}${ANSI_RESET}${badges}`;
    }
    const cliColor = resolveCarrierColor(col.cli) || PANEL_COLOR;
    const isStreaming = footerCol.status === "conn" || footerCol.status === "stream";
    // 스트리밍 중: 아이콘 유지 + 이름에 파도 그라데이션
    return isStreaming
      ? `${statusIcon(footerCol, input.frame, false)} ${waveText(name, resolveCarrierRgb(col.cli), input.frame)}${badges}${ANSI_RESET}`
      : `${statusIcon(footerCol, input.frame, false)} ${cliColor}${name}${badges}${ANSI_RESET}`;
  });

  if (segments.length === 0) return undefined;
  return segments.join(`${PANEL_DIM_COLOR} │ ${ANSI_RESET}`);
}

// ─── 내부 헬퍼 ────────────────────────────────────────────

function statusIcon(col: AgentCol, frame: number, disabled: boolean): string {
  // sortie 비활성 캐리어: dim 아이콘으로 표시
  if (disabled) {
    return `${DISABLED_COLOR}○${ANSI_RESET}`;
  }
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
