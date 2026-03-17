/**
 * utils-improve-prompt/ui.ts — footer 상태 세그먼트 발행
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { ReasoningLevel } from "./constants.js";
import { REASONING_COLORS, REASONING_LABELS } from "./constants.js";
import { loadSettings } from "./settings.js";
import { PANEL_COLOR, PANEL_DIM_COLOR, ANSI_RESET } from "../unified-agent-direct/constants.js";

/** footer에 MP 세그먼트 발행 */
export function updateStatus(ctx: ExtensionContext, currentReasoning: ReasoningLevel): void {
  const settings = loadSettings();
  const modelLabel = settings.provider && settings.model
    ? settings.model
    : "session model";

  const theme = (ctx as any).ui.theme;
  const reasonLabel = theme.fg(
    REASONING_COLORS[currentReasoning],
    REASONING_LABELS[currentReasoning],
  );

  const segment =
    `${PANEL_DIM_COLOR}◇ ${ANSI_RESET}` +
    `${PANEL_COLOR}MP${ANSI_RESET}` +
    `${PANEL_DIM_COLOR} (${ANSI_RESET}` +
    `${theme.fg("accent", modelLabel)}` +
    `${PANEL_DIM_COLOR} · ${ANSI_RESET}` +
    reasonLabel +
    `${PANEL_DIM_COLOR})${ANSI_RESET}`;

  ctx.ui.setStatus("mp-footer", segment);
}
