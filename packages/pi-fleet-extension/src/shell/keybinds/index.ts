import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerAgentPanelShortcut } from "../../agent/ui/alt-p-panel-detail.js";
import { registerCarrierStatusKeybind } from "../../agent/ui/alt-o-status-overlay.js";
import registerCoreKeybinds from "./core-keybind-register.js";

export function registerShellKeybinds(pi: ExtensionAPI): void {
  registerCoreKeybinds(pi);
}

export function registerKeybinds(pi: ExtensionAPI, fleetEnabled: boolean): void {
  if (!fleetEnabled) return;
  registerAgentPanelShortcut();
  registerCarrierStatusKeybind(pi);
}
