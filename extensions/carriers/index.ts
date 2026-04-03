/**
 * carriers — 독립 캐리어 등록 확장 진입점
 *
 * 8개 캐리어를 shipyard/carrier 프레임워크 SDK를 통해 등록합니다.
 * fleet/ 확장과는 독립적으로 동작하며, settings.json에서 선택적으로 등록/해제 가능합니다.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerGenesisCarrier } from "./genesis.js";
import { registerArbiterCarrier } from "./arbiter.js";
import { registerCrucibleCarrier } from "./crucible.js";
import { registerSentinelCarrier } from "./sentinel.js";
import { registerRavenCarrier } from "./raven.js";
import { registerVanguardCarrier } from "./vanguard.js";
import { registerEchelonCarrier } from "./echelon.js";
import { registerChronicleCarrier } from "./chronicle.js";

export default function fleetCarriersExtension(pi: ExtensionAPI): void {
  registerGenesisCarrier(pi);    // slot 1 — alt+1  (claude)
  registerArbiterCarrier(pi);    // slot 2 — alt+2  (claude)
  registerCrucibleCarrier(pi);   // slot 3 — alt+3  (codex)
  registerSentinelCarrier(pi);   // slot 4 — alt+4  (codex)
  registerRavenCarrier(pi);      // slot 5 — alt+5  (codex)
  registerVanguardCarrier(pi);   // slot 6 — alt+6  (gemini)
  registerEchelonCarrier(pi);    // slot 7 — alt+7  (gemini)
  registerChronicleCarrier(pi);  // slot 8 — alt+8  (gemini)
}
