/**
 * fleet/captains — captain 등록 배럴
 *
 * 등록된 captain 수만큼 carrier가 동적으로 생성됩니다.
 * 새 captain 추가: 파일 생성 → 여기에 import/export/registerXxx 추가.
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
 * captain 등록 순서 = slot 번호 순서 (alt+1 ~ alt+N).
 */
export function registerCaptains(pi: ExtensionAPI): void {
  registerClaudeCaptain(pi);   // slot 1 — alt+1
  registerCodexCaptain(pi);    // slot 2 — alt+2
  registerGeminiCaptain(pi);   // slot 3 — alt+3
}
