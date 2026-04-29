import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { onStatusUpdate } from "./carrier/framework.js";
import { syncModelConfig } from "../commands/carrier/model-ui.js";
import { registerPushModeSettingsSection } from "../config-bridge/fleet-push-mode-settings.js";
import registerExperimentalWiki from "./experimental-wiki/index.js";
import { registerFleetPiTools } from "./fleet-pi-tools.js";

export function registerTools(pi: ExtensionAPI, fleetEnabled: boolean): void {
  if (fleetEnabled) {
    registerFleetPiTools(pi);
    onStatusUpdate(() => {
      syncModelConfig();
    });
    registerPushModeSettingsSection();
  }

  registerExperimentalWiki(pi);
}
