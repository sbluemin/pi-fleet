/**
 * fleet/shipyard/squadron/index.ts — Squadron 모듈 공개 API
 */

import { ensureShipyardLogCategories } from "../carrier/register.js";

ensureShipyardLogCategories();

export type { SubtaskProgress, SquadronResult, SquadronState } from "@sbluemin/fleet-core/squadron";
export { SQUADRON_STATE_KEY, SQUADRON_MAX_INSTANCES } from "@sbluemin/fleet-core/squadron";
