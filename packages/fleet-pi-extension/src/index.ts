import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerBoot from "./boot/index.js";
import registerCore from "./core/index.js";
import registerFleet from "./fleet/index.js";
import registerGrandFleet from "./grand-fleet/index.js";
import registerMetaphor from "./metaphor/index.js";
import registerDiagnostics from "./diagnostics/index.js";
import registerExperimentalWiki from "./experimental-wiki/index.js";

export default function fleetPiExtension(pi: ExtensionAPI): void {
  registerBoot(pi);
  registerCore(pi);
  registerFleet(pi);
  registerMetaphor(pi);
  registerGrandFleet(pi);
  registerDiagnostics(pi);
  registerExperimentalWiki(pi);
}
