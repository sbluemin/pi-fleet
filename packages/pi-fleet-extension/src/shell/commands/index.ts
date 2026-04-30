import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerProviderGuardCommand from "../../agent/provider-guard-command.js";
import { registerModelCommands, syncModelConfig } from "../../agent/carrier/model-ui.js";
import { registerFleetPiCommands } from "../../fleet.js";
import registerMetaphor from "../../metaphor.js";
import registerHudCommand from "./hud-command.js";
import registerKeybindPopupCommand from "./keybind-command.js";
import registerWelcomeUpdateCommand from "./welcome-update.js";

export function registerShellCommands(pi: ExtensionAPI): void {
  registerHudCommand(pi);
  registerKeybindPopupCommand(pi);
  registerWelcomeUpdateCommand(pi);
}

export function registerCommands(pi: ExtensionAPI, fleetEnabled: boolean): void {
  registerProviderGuardCommand(pi);
  if (!fleetEnabled) return;
  registerMetaphor(pi);
  syncModelConfig();
  registerModelCommands(pi);
  registerFleetPiCommands(pi);
}
