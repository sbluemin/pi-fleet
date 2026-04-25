import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerChronicleCarrier } from "./chronicle.js";
import { registerGenesisCarrier } from "./genesis.js";
import { registerKirovCarrier } from "./kirov.js";
import { registerNimitzCarrier } from "./nimitz.js";
import { registerOhioCarrier } from "./ohio.js";
import { registerSentinelCarrier } from "./sentinel.js";
import { registerTempestCarrier } from "./tempest.js";
import { registerVanguardCarrier } from "./vanguard.js";

export function registerFleetCarriers(pi: ExtensionAPI): void {
  registerGenesisCarrier(pi);
  registerKirovCarrier(pi);
  registerNimitzCarrier(pi);
  registerSentinelCarrier(pi);
  registerVanguardCarrier(pi);
  registerTempestCarrier(pi);
  registerChronicleCarrier(pi);
  registerOhioCarrier(pi);
}
