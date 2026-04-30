import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerFleet from "./fleet/register.js";

export function registerFleetGrandFleet(pi: ExtensionAPI): void {
  registerFleet(pi);
}
