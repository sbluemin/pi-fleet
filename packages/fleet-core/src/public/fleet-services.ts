import * as AdmiralProtocolFacade from "../admiral/index.js";
import * as CarrierServiceFacade from "../admiral/carrier/index.js";
import * as SquadronServiceFacade from "../admiral/squadron/index.js";
import * as TaskForceServiceFacade from "../admiral/taskforce/index.js";

export interface FleetServices {
  readonly protocols: typeof AdmiralProtocolFacade;
  readonly carrier: typeof CarrierServiceFacade;
  readonly squadron: typeof SquadronServiceFacade;
  readonly taskForce: typeof TaskForceServiceFacade;
}

const FLEET_SERVICES: FleetServices = {
  protocols: AdmiralProtocolFacade,
  carrier: CarrierServiceFacade,
  squadron: SquadronServiceFacade,
  taskForce: TaskForceServiceFacade,
};

export function createFleetServices(): FleetServices {
  return FLEET_SERVICES;
}
