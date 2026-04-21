import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerAthenaCarrier } from "./athena.js";
import { registerChronicleCarrier } from "./chronicle.js";
import { registerEchelonCarrier } from "./echelon.js";
import { registerGenesisCarrier } from "./genesis.js";
import { registerOracleCarrier } from "./oracle.js";
import { registerSentinelCarrier } from "./sentinel.js";
import { registerVanguardCarrier } from "./vanguard.js";

export function registerFleetCarriers(pi: ExtensionAPI): void {
  registerGenesisCarrier(pi);
  registerAthenaCarrier(pi);
  registerOracleCarrier(pi);
  registerSentinelCarrier(pi);
  registerVanguardCarrier(pi);
  registerEchelonCarrier(pi);
  registerChronicleCarrier(pi);
}
