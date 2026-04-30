import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerWelcome from "./welcome/register.js";
import { bootBridge } from "./fleet-bridge.js";
import { bindPanelBackgroundJobAnimation } from "../agent/ui/panel-lifecycle.js";

export function mountShellSurfaces(pi: ExtensionAPI): void {
  registerWelcome(pi);
}

export function mountTuiSurfaces(pi: ExtensionAPI, fleetEnabled: boolean): void {
  if (!fleetEnabled) return;
  bootBridge(pi);
  bindPanelBackgroundJobAnimation();
}
