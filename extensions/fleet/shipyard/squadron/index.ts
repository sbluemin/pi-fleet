/**
 * fleet/shipyard/squadron/index.ts — Squadron 모듈 공개 API
 */

import { ensureShipyardLogCategories } from "../carrier/register.js";

ensureShipyardLogCategories();

export { buildSquadronToolConfig } from "./squadron.js";
export type { SubtaskProgress, SquadronResult, SquadronState } from "./types.js";
export { SQUADRON_STATE_KEY, SQUADRON_RESULT_CACHE_KEY, SQUADRON_MAX_INSTANCES } from "./types.js";
