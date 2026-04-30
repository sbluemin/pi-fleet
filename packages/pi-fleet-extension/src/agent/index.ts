import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerProvider } from "./provider.js";
import { registerAgentPanelShortcut } from "./ui/alt-p-panel-detail.js";
import { registerCarrierStatusKeybind } from "./ui/alt-o-status-overlay.js";

export function registerAgent(ctx: ExtensionAPI): void {
  registerAgentPanelShortcut();
  registerCarrierStatusKeybind(ctx);
  registerProvider(ctx);
}
