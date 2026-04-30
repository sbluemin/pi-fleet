/**
 * fleet/shipyard/taskforce/index.ts — Task Force 모듈 공개 API
 */

import { ensureShipyardLogCategories } from "../carrier/register.js";

ensureShipyardLogCategories();

export type { BackendProgress, TaskForceResult, TaskForceState } from "@sbluemin/fleet-core/admiral/taskforce";
export { TASKFORCE_STATE_KEY } from "@sbluemin/fleet-core/admiral/taskforce";
