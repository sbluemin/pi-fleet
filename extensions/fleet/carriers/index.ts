/**
 * fleet/carriers — carrier 등록 배럴
 *
 * 등록된 carrier 수만큼 Carrier가 동적으로 생성됩니다.
 * 새 carrier 추가: 파일 생성 → 여기에 import/export/registerXxx 추가.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerGenesisCarrier } from "./genesis.js";
import { registerSentinelCarrier } from "./sentinel.js";
import { registerVanguardCarrier } from "./vanguard.js";
import { registerEchelonCarrier } from "./echelon.js";
import { registerRavenCarrier } from "./raven.js";
import { registerChronicleCarrier } from "./chronicle.js";
import { registerCrucibleCarrier } from "./crucible.js";
import { registerArbiterCarrier } from "./arbiter.js";

export { registerGenesisCarrier } from "./genesis.js";
export { registerSentinelCarrier } from "./sentinel.js";
export { registerVanguardCarrier } from "./vanguard.js";
export { registerEchelonCarrier } from "./echelon.js";
export { registerRavenCarrier } from "./raven.js";
export { registerChronicleCarrier } from "./chronicle.js";
export { registerCrucibleCarrier } from "./crucible.js";
export { registerArbiterCarrier } from "./arbiter.js";

/**
 * 모든 carrier를 한 번에 등록합니다.
 *
 * 각 carrier는 Carrier 프레임워크에 등록됩니다 (단축키, direct mode, 프롬프트 메타데이터).
 * carrier 등록 순서 = slot 번호 순서 (alt+1 ~ alt+N).
 */
export function registerCarriers(pi: ExtensionAPI): void {
  registerGenesisCarrier(pi);    // slot 1 — alt+1
  registerSentinelCarrier(pi);   // slot 2 — alt+2
  registerVanguardCarrier(pi);   // slot 3 — alt+3
  registerEchelonCarrier(pi);    // slot 4 — alt+4
  registerRavenCarrier(pi);      // slot 5 — alt+5
  registerChronicleCarrier(pi);  // slot 6 — alt+6
  registerCrucibleCarrier(pi);   // slot 7 — alt+7
  registerArbiterCarrier(pi);    // slot 8 — alt+8
}
