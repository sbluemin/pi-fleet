/**
 * utils-summarize/ui.ts — footer 상태 세그먼트 발행
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { PANEL_COLOR, PANEL_DIM_COLOR, ANSI_RESET } from "../unified-agent-direct/constants.js";

/** footer에 AS 세그먼트 발행 */
export function updateStatus(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const currentName = pi.getSessionName();

  const nameLabel = currentName
    ? `${(ctx as any).ui.theme.fg("accent", currentName)}`
    : `${PANEL_DIM_COLOR}요약 대기${ANSI_RESET}`;

  const segment =
    `${PANEL_DIM_COLOR}◇ ${ANSI_RESET}` +
    `${PANEL_COLOR}AS${ANSI_RESET}` +
    `${PANEL_DIM_COLOR} (${ANSI_RESET}` +
    nameLabel +
    `${PANEL_DIM_COLOR})${ANSI_RESET}`;

  ctx.ui.setStatus("as-footer", segment);
}
