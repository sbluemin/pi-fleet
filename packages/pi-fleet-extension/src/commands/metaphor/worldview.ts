/**
 * metaphor — PERSONA/TONE worldview 토글 + 세션 작전명 자동 생성 확장
 *
 * 이 확장은 metaphor settings 상태, 토글 커맨드, 작전명 자동 생성 기능을 소유한다.
 * 실제 프롬프트 조립은 다른 패키지의 builder가 담당한다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isWorldviewEnabled, setWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";

import registerDirectiveRefinement from "./directive-refinement-register.js";
import { registerOperationName } from "./operation-name-command.js";

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
  registerDirectiveRefinement(pi);
  registerOperationName(pi);
}
