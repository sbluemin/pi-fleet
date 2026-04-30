import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerProviderRuntime from "./provider-internal/provider-register.js";
import { registerAgentPanelShortcut } from "./ui/alt-p-panel-detail.js";
import { registerCarrierStatusKeybind } from "./ui/alt-o-status-overlay.js";
import { bindPanelBackgroundJobAnimation } from "./ui/panel-lifecycle.js";

export function registerAgent(ctx: ExtensionAPI): void {
  registerAgentPanelShortcut();
  registerCarrierStatusKeybind(ctx);
  bindPanelBackgroundJobAnimation();
  registerProviderRuntime(ctx);
}
