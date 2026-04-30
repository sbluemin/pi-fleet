import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerAdmiralty from "./admiralty/register.js";

export function registerAdmiraltyGrandFleet(pi: ExtensionAPI): void {
  registerAdmiralty(pi);
}
