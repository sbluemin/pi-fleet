import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerHudCommand from "./core-hud-command.js";
import registerKeybindPopupCommand from "./core-keybind-command.js";
import registerLogCommands from "./core-log-commands.js";
import registerProviderGuardCommand from "./core-provider-guard-command.js";
import registerWelcomeUpdateCommand from "./core-welcome-update.js";
import { registerModelCommands, syncModelConfig } from "./carrier/model-ui.js";
import registerOperationNameCommand from "./metaphor/operation-name-command.js";
import registerMetaphor from "./metaphor/worldview.js";
import { registerFleetPiCommands } from "./fleet-pi-commands.js";

export function registerCommands(pi: ExtensionAPI, fleetEnabled: boolean): void {
  registerHudCommand(pi);
  registerKeybindPopupCommand(pi);
  registerLogCommands(pi);
  registerProviderGuardCommand(pi);
  registerWelcomeUpdateCommand(pi);
  registerMetaphor(pi);
  registerOperationNameCommand(pi);
  if (!fleetEnabled) return;
  syncModelConfig();
  registerModelCommands(pi);
  registerFleetPiCommands(pi);
}
