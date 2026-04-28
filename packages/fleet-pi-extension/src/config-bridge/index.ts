import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerSettings from "./settings/register.js";

export function mountConfigBridge(pi: ExtensionAPI): void {
  registerSettings(pi);
}
