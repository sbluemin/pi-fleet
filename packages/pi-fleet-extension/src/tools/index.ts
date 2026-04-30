import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { onStatusUpdate } from "./carrier/framework.js";
import { syncModelConfig } from "../commands/carrier/model-ui.js";
import { registerPushModeSettingsSection } from "../tools/settings/fleet-push-mode-settings.js";
import registerFleetWiki from "./fleet-wiki/index.js";
import { registerFleetPiTools } from "./fleet-pi-tools.js";

export function registerTools(pi: ExtensionAPI, fleetEnabled: boolean): void {
  if (fleetEnabled) {
    registerFleetPiTools(pi);
    onStatusUpdate(() => {
      syncModelConfig();
    });
    registerPushModeSettingsSection();
  }

  registerFleetWiki(pi);
}
