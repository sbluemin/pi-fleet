import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerAgentPanelShortcut } from "./alt-p-panel-detail.js";
import { registerCarrierStatusKeybind } from "./alt-o-status-overlay.js";
import registerCoreKeybinds from "./core-keybind-register.js";
import registerSettingsOverlayKeybind from "./settings-overlay-register.js";

export function registerKeybinds(pi: ExtensionAPI, fleetEnabled: boolean): void {
  registerCoreKeybinds(pi);
  registerSettingsOverlayKeybind();
  if (!fleetEnabled) return;
  registerAgentPanelShortcut();
  registerCarrierStatusKeybind(pi);
}
