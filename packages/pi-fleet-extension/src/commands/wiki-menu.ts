import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { openWikiHub } from "../tui/fleet-wiki/overlay.js";

export function registerWikiCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:wiki:menu", {
    description: "Fleet Wiki 인터랙티브 허브",
    handler: async (_args, ctx) => {
      await openWikiHub(pi, ctx);
    },
  });
}
