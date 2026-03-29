/**
 * fleet/captains — captain 등록 배럴
 *
 * 3명의 captain(claude, codex, gemini)이
 * 각 carrier + PI 도구 등록을 통합 제공합니다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerClaudeCaptain } from "./claude.js";
import { registerCodexCaptain } from "./codex.js";
import { registerGeminiCaptain } from "./gemini.js";

export { registerClaudeCaptain } from "./claude.js";
export { registerCodexCaptain } from "./codex.js";
export { registerGeminiCaptain } from "./gemini.js";

/**
 * 모든 captain을 한 번에 등록합니다.
 *
 * 각 captain은 담당 carrier + PI 도구를 함께 등록합니다.
 */
export function registerCaptains(pi: ExtensionAPI): void {
  registerClaudeCaptain(pi);
  registerCodexCaptain(pi);
  registerGeminiCaptain(pi);
}
