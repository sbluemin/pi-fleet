import * as GrandFleetServiceFacade from "../admiralty/index.js";

export interface GrandFleetServices {
  readonly admiralty: typeof GrandFleetServiceFacade;
}

const GRAND_FLEET_SERVICES: GrandFleetServices = {
  admiralty: GrandFleetServiceFacade,
};

export function createGrandFleetServices(): GrandFleetServices {
  return GRAND_FLEET_SERVICES;
}
