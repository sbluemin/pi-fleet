/**
 * metaphor — PERSONA/TONE worldview 토글 전용 확장
 *
 * 이 확장은 metaphor settings 상태와 토글 커맨드만 소유한다.
 * 실제 프롬프트 조립은 다른 패키지의 builder가 담당한다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { isWorldviewEnabled, setWorldviewEnabled } from "./worldview.js";

/**
 * metaphor worldview 토글 커맨드를 등록한다.
 */
export function registerMetaphor(pi: ExtensionAPI): void {
  pi.registerCommand("metaphor:worldview", {
    description: "metaphor PERSONA/TONE worldview 토글 (on/off)",
    handler: async (_args, ctx) => {
      const current = isWorldviewEnabled();
      const next = !current;
      setWorldviewEnabled(next);
      ctx.ui.notify(
        `Metaphor Worldview → ${next ? "ON" : "OFF"} (다음 턴부터 적용)`,
        "info",
      );
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerMetaphor(pi);
}
