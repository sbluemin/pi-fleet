import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerWelcome from "./welcome/register.js";
import { bootBridge } from "./fleet-bridge.js";
import { bindPanelBackgroundJobAnimation } from "./panel-lifecycle.js";

export function mountTuiSurfaces(pi: ExtensionAPI, fleetEnabled: boolean): void {
  registerWelcome(pi);

  if (!fleetEnabled) return;
  bootBridge(pi);
  bindPanelBackgroundJobAnimation();
}
